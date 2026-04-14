const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'app-data.local.json');
const CANVAS_TOKEN = process.env.CANVAS_API_KEY || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'studysync-dev-session-secret';
const ENCRYPTION_KEY = crypto.createHash('sha256').update(SESSION_SECRET).digest();

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        {
          meta: { nextId: 1 },
          users: [],
          sessions: [],
          assignments: [],
          calendarEvents: []
        },
        null,
        2
      )
    );
  }
}

function loadDb() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function nextId(db) {
  const id = db.meta.nextId;
  db.meta.nextId += 1;
  return id;
}

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    theme: user.theme || 'light',
    canvas: {
      baseUrl: user.canvas?.baseUrl || '',
      lastSyncedAt: user.canvas?.lastSyncedAt || null,
      lastSyncSummary: user.canvas?.lastSyncSummary || null
    },
    createdAt: user.createdAt
  };
}

function normalizeEmail(email = '') {
  return email.trim().toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, user) {
  const { hash } = hashPassword(password, user.passwordSalt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.passwordHash, 'hex'));
}

function createSessionToken(userId) {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`${userId}:${crypto.randomBytes(24).toString('hex')}:${Date.now()}`)
    .digest('hex');
}

function encryptSecret(value) {
  if (!value) {
    return '';
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSecret(payload) {
  if (!payload) {
    return '';
  }

  const [ivHex, tagHex, encryptedHex] = payload.split(':');
  if (!ivHex || !tagHex || !encryptedHex) {
    return '';
  }

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, 'hex')),
      decipher.final()
    ]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
}

function getAuthToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return null;
  }

  return header.slice(7).trim();
}

function requireAuth(req, res, next) {
  const token = getAuthToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const db = loadDb();
  const session = db.sessions.find((entry) => entry.token === token);
  if (!session) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  const user = db.users.find((entry) => entry.id === session.userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  session.lastActiveAt = new Date().toISOString();
  saveDb(db);

  req.db = db;
  req.user = user;
  req.session = session;
  next();
}

function userAssignments(db, userId) {
  return db.assignments.filter((assignment) => assignment.userId === userId);
}

function userEvents(db, userId) {
  return db.calendarEvents.filter((event) => event.userId === userId);
}

function parseCanvasNextLink(linkHeader = '') {
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/i);
  return match ? match[1] : null;
}

async function fetchCanvasPages(baseUrl, token, endpoint) {
  const pages = [];
  let url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;

  while (url) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Canvas request failed (${response.status}): ${text.slice(0, 180)}`);
    }

    const data = await response.json();
    pages.push(...(Array.isArray(data) ? data : [data]));
    url = parseCanvasNextLink(response.headers.get('link'));
  }

  return pages;
}

function canvasConfigForUser(user) {
  const baseUrl = (user.canvas?.baseUrl || process.env.CANVAS_BASE_URL || 'https://psu.instructure.com').trim().replace(/\/$/, '');
  const userToken = decryptSecret(user.canvas?.apiKeyEncrypted || '');
  const token = userToken || CANVAS_TOKEN;
  return {
    baseUrl,
    token,
    hasToken: Boolean(token),
    hasUserToken: Boolean(userToken),
    hasServerToken: Boolean(CANVAS_TOKEN)
  };
}

async function syncCanvasForUser(db, user) {
  const { baseUrl, hasToken, token } = canvasConfigForUser(user);
  if (!hasToken) {
    throw new Error('Missing Canvas API key');
  }

  if (!baseUrl) {
    throw new Error('Canvas base URL is not configured');
  }

  const courses = await fetchCanvasPages(baseUrl, token, '/api/v1/courses?enrollment_state=active&state[]=available&per_page=100');
  const courseMap = new Map(courses.map((course) => [course.id, course]));

  const assignmentResponses = await Promise.all(
    courses.map((course) =>
      fetchCanvasPages(
        baseUrl,
        token,
        `/api/v1/courses/${course.id}/assignments?per_page=100&order_by=due_at&include[]=submission`
      )
    )
  );

  const now = new Date();
  const rangeStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rangeEnd = new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000).toISOString();
  const calendarEvents = await fetchCanvasPages(
    baseUrl,
    token,
    `/api/v1/calendar_events?all_events=true&per_page=100&start_date=${encodeURIComponent(rangeStart)}&end_date=${encodeURIComponent(rangeEnd)}`
  );

  const flattenedAssignments = assignmentResponses
    .flat()
    .filter((assignment) => assignment && assignment.due_at)
    .map((assignment) => ({
      canvasAssignmentId: assignment.id,
      canvasCourseId: assignment.course_id,
      title: assignment.name,
      course: courseMap.get(assignment.course_id)?.course_code || courseMap.get(assignment.course_id)?.name || 'Canvas',
      dueDate: assignment.due_at,
      estimatedHours: 2,
      priority: new Date(assignment.due_at) <= new Date(now.getTime() + 48 * 60 * 60 * 1000) ? 'high' : 'medium',
      instructions: assignment.description || '',
      completed: Boolean(assignment.submission?.submitted_at),
      htmlUrl: assignment.html_url || '',
      source: 'canvas',
      syncedAt: new Date().toISOString()
    }));

  const flattenedEvents = calendarEvents.map((event) => ({
    canvasEventId: event.id,
    title: event.title || event.description || 'Canvas event',
    startTime: event.start_at || event.created_at,
    endTime: event.end_at || event.start_at || event.created_at,
    type: event.context_code?.startsWith('course_') ? 'class' : 'canvas',
    location: event.location_name || '',
    description: event.description || '',
    source: 'canvas',
    syncedAt: new Date().toISOString()
  }));

  const assignmentIds = new Set(flattenedAssignments.map((entry) => `${entry.canvasCourseId}:${entry.canvasAssignmentId}`));
  const eventIds = new Set(flattenedEvents.map((entry) => `${entry.canvasEventId}`));

  db.assignments = db.assignments.filter(
    (assignment) =>
      assignment.userId !== user.id ||
      assignment.source !== 'canvas' ||
      assignmentIds.has(`${assignment.canvasCourseId}:${assignment.canvasAssignmentId}`)
  );

  db.calendarEvents = db.calendarEvents.filter(
    (event) => event.userId !== user.id || event.source !== 'canvas' || eventIds.has(`${event.canvasEventId}`)
  );

  flattenedAssignments.forEach((incoming) => {
    const existing = db.assignments.find(
      (assignment) =>
        assignment.userId === user.id &&
        assignment.source === 'canvas' &&
        assignment.canvasAssignmentId === incoming.canvasAssignmentId &&
        assignment.canvasCourseId === incoming.canvasCourseId
    );

    if (existing) {
      Object.assign(existing, incoming);
      return;
    }

    db.assignments.push({
      id: nextId(db),
      userId: user.id,
      createdAt: new Date().toISOString(),
      ...incoming
    });
  });

  flattenedEvents.forEach((incoming) => {
    const existing = db.calendarEvents.find(
      (event) =>
        event.userId === user.id &&
        event.source === 'canvas' &&
        event.canvasEventId === incoming.canvasEventId
    );

    if (existing) {
      Object.assign(existing, incoming);
      return;
    }

    db.calendarEvents.push({
      id: nextId(db),
      userId: user.id,
      createdAt: new Date().toISOString(),
      ...incoming
    });
  });

  user.canvas = user.canvas || {};
  user.canvas.lastSyncedAt = new Date().toISOString();
  user.canvas.lastSyncSummary = {
    courses: courses.length,
    assignments: flattenedAssignments.length,
    events: flattenedEvents.length
  };

  saveDb(db);

  return {
    courses: courses.length,
    assignments: flattenedAssignments.length,
    events: flattenedEvents.length,
    lastSyncedAt: user.canvas.lastSyncedAt
  };
}

app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name?.trim() || !email?.trim() || !password?.trim()) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const db = loadDb();
  const normalizedEmail = normalizeEmail(email);
  if (db.users.some((user) => user.email === normalizedEmail)) {
    return res.status(409).json({ error: 'An account with that email already exists' });
  }

  const { salt, hash } = hashPassword(password);
  const user = {
    id: nextId(db),
    name: name.trim(),
    email: normalizedEmail,
    passwordSalt: salt,
    passwordHash: hash,
    theme: 'light',
    canvas: {
      baseUrl: process.env.CANVAS_BASE_URL || 'https://psu.instructure.com',
      apiKeyEncrypted: '',
      lastSyncedAt: null,
      lastSyncSummary: null
    },
    createdAt: new Date().toISOString()
  };

  const token = createSessionToken(user.id);
  db.users.push(user);
  db.sessions.push({
    token,
    userId: user.id,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString()
  });
  saveDb(db);

  res.status(201).json({ token, user: sanitizeUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const db = loadDb();
  const user = db.users.find((entry) => entry.email === normalizeEmail(email));

  if (!user || !verifyPassword(password || '', user)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = createSessionToken(user.id);
  db.sessions.push({
    token,
    userId: user.id,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString()
  });
  saveDb(db);

  res.json({ token, user: sanitizeUser(user) });
});

app.get('/api/auth/session', requireAuth, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  req.db.sessions = req.db.sessions.filter((session) => session.token !== req.session.token);
  saveDb(req.db);
  res.json({ success: true });
});

app.put('/api/profile/preferences', requireAuth, (req, res) => {
  const { theme } = req.body;
  if (theme && !['light', 'dark'].includes(theme)) {
    return res.status(400).json({ error: 'Invalid theme' });
  }

  if (theme) {
    req.user.theme = theme;
  }

  saveDb(req.db);
  res.json({ user: sanitizeUser(req.user) });
});

app.get('/api/assignments', requireAuth, (req, res) => {
  const sorted = userAssignments(req.db, req.user.id).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  res.json(sorted);
});

app.post('/api/assignments', requireAuth, (req, res) => {
  const { title, course, dueDate, estimatedHours, priority, instructions } = req.body;

  if (!title || !course || !dueDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const assignment = {
    id: nextId(req.db),
    userId: req.user.id,
    title,
    course,
    dueDate,
    estimatedHours: estimatedHours || 5,
    priority: priority || 'medium',
    instructions: instructions || '',
    completed: false,
    source: 'manual',
    createdAt: new Date().toISOString()
  };

  req.db.assignments.push(assignment);
  saveDb(req.db);
  res.status(201).json(assignment);
});

app.put('/api/assignments/:id', requireAuth, (req, res) => {
  const assignment = req.db.assignments.find(
    (entry) => entry.id === parseInt(req.params.id, 10) && entry.userId === req.user.id
  );
  if (!assignment) {
    return res.status(404).json({ error: 'Not found' });
  }

  const allowedUpdates = ['title', 'course', 'dueDate', 'estimatedHours', 'priority', 'instructions', 'completed'];
  allowedUpdates.forEach((field) => {
    if (req.body[field] !== undefined) {
      assignment[field] = req.body[field];
    }
  });
  assignment.updatedAt = new Date().toISOString();

  saveDb(req.db);
  res.json(assignment);
});

app.delete('/api/assignments/:id', requireAuth, (req, res) => {
  const idx = req.db.assignments.findIndex(
    (entry) => entry.id === parseInt(req.params.id, 10) && entry.userId === req.user.id
  );
  if (idx === -1) {
    return res.status(404).json({ error: 'Not found' });
  }

  const deleted = req.db.assignments.splice(idx, 1);
  saveDb(req.db);
  res.json({ deleted: deleted[0] });
});

app.get('/api/assignments/prioritized/list', requireAuth, (req, res) => {
  const scored = userAssignments(req.db, req.user.id)
    .map((assignment) => {
      const daysUntilDue = (new Date(assignment.dueDate) - new Date()) / (1000 * 60 * 60 * 24);
      const urgencyScore = Math.max(0, 10 - daysUntilDue);
      const priorityScore = { high: 3, medium: 2, low: 1 }[assignment.priority] || 2;

      return { ...assignment, score: urgencyScore + priorityScore };
    })
    .sort((a, b) => b.score - a.score);

  res.json(scored);
});

app.get('/api/calendar/events', requireAuth, (req, res) => {
  const sorted = userEvents(req.db, req.user.id).sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  res.json(sorted);
});

app.post('/api/calendar/events', requireAuth, (req, res) => {
  const { title, startTime, endTime, type } = req.body;
  if (!title || !startTime) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const event = {
    id: nextId(req.db),
    userId: req.user.id,
    title,
    startTime,
    endTime: endTime || startTime,
    type: type || 'event',
    source: 'manual',
    createdAt: new Date().toISOString()
  };

  req.db.calendarEvents.push(event);
  saveDb(req.db);
  res.status(201).json(event);
});

app.delete('/api/calendar/events/:id', requireAuth, (req, res) => {
  const idx = req.db.calendarEvents.findIndex(
    (entry) => entry.id === parseInt(req.params.id, 10) && entry.userId === req.user.id
  );
  if (idx === -1) {
    return res.status(404).json({ error: 'Not found' });
  }

  const deleted = req.db.calendarEvents.splice(idx, 1);
  saveDb(req.db);
  res.json({ deleted: deleted[0] });
});

app.get('/api/notifications', requireAuth, (req, res) => {
  const now = new Date();
  const notifications = [];

  userAssignments(req.db, req.user.id).forEach((assignment) => {
    if (assignment.completed) {
      return;
    }

    const dueDate = new Date(assignment.dueDate);
    const daysUntilDue = (dueDate - now) / (1000 * 60 * 60 * 24);

    if (daysUntilDue <= 1 && daysUntilDue > 0) {
      notifications.push({
        id: assignment.id,
        type: 'due_soon',
        message: `${assignment.title} is due in ${daysUntilDue.toFixed(1)} days`,
        assignment
      });
    }
  });

  res.json(notifications);
});

app.get('/api/canvas/status', requireAuth, (req, res) => {
  const config = canvasConfigForUser(req.user);
  res.json({
    configured: Boolean(config.baseUrl && config.hasToken),
    hasToken: config.hasToken,
    hasUserToken: config.hasUserToken,
    hasServerToken: config.hasServerToken,
    baseUrl: config.baseUrl,
    lastSyncedAt: req.user.canvas?.lastSyncedAt || null,
    lastSyncSummary: req.user.canvas?.lastSyncSummary || null
  });
});

app.put('/api/canvas/config', requireAuth, (req, res) => {
  const { baseUrl, apiKey } = req.body;
  const normalized = (baseUrl || '').trim().replace(/\/$/, '');

  if (normalized && !/^https:\/\/.+/i.test(normalized)) {
    return res.status(400).json({ error: 'Canvas URL must start with https://' });
  }

  req.user.canvas = req.user.canvas || {};
  req.user.canvas.baseUrl = normalized || 'https://psu.instructure.com';
  if (apiKey !== undefined) {
    req.user.canvas.apiKeyEncrypted = apiKey.trim() ? encryptSecret(apiKey.trim()) : '';
  }
  saveDb(req.db);

  const config = canvasConfigForUser(req.user);
  res.json({
    baseUrl: req.user.canvas.baseUrl,
    hasToken: config.hasToken,
    hasUserToken: config.hasUserToken,
    hasServerToken: config.hasServerToken
  });
});

app.post('/api/canvas/sync', requireAuth, async (req, res) => {
  try {
    const summary = await syncCanvasForUser(req.db, req.user);
    res.json(summary);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/demo/load', requireAuth, (req, res) => {
  req.db.assignments = req.db.assignments.filter((assignment) => assignment.userId !== req.user.id);
  req.db.calendarEvents = req.db.calendarEvents.filter((event) => event.userId !== req.user.id);

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in3days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const assignments = [
    {
      id: nextId(req.db),
      userId: req.user.id,
      title: 'ETI 421 Project Deliverable 3',
      course: 'ETI 421',
      dueDate: tomorrow.toISOString(),
      estimatedHours: 8,
      priority: 'high',
      instructions: 'Complete prototype and documentation',
      completed: false,
      source: 'manual',
      createdAt: new Date().toISOString()
    },
    {
      id: nextId(req.db),
      userId: req.user.id,
      title: 'Linear Algebra Problem Set',
      course: 'MATH 220',
      dueDate: in3days.toISOString(),
      estimatedHours: 4,
      priority: 'medium',
      instructions: 'Chapter 5, problems 1-30',
      completed: false,
      source: 'manual',
      createdAt: new Date().toISOString()
    },
    {
      id: nextId(req.db),
      userId: req.user.id,
      title: 'Data Structures Quiz',
      course: 'CMPSC 202',
      dueDate: in7days.toISOString(),
      estimatedHours: 2,
      priority: 'low',
      instructions: 'Study chapters 4-6',
      completed: false,
      source: 'manual',
      createdAt: new Date().toISOString()
    }
  ];

  const events = [
    {
      id: nextId(req.db),
      userId: req.user.id,
      title: 'ETI 421 Class',
      startTime: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      endTime: new Date(now.getTime() + 3.5 * 60 * 60 * 1000).toISOString(),
      type: 'lecture',
      source: 'manual',
      createdAt: new Date().toISOString()
    }
  ];

  req.db.assignments.push(...assignments);
  req.db.calendarEvents.push(...events);
  saveDb(req.db);

  res.json({ message: 'Demo data loaded', assignments, events });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    canvasConfigured: Boolean(CANVAS_TOKEN)
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

ensureDataFile();
app.listen(PORT, () => {
  console.log(`StudySync running on http://localhost:${PORT}`);
});
