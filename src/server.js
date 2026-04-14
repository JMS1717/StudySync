const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// In-memory storage
let assignments = [];
let calendarEvents = [];
let id_counter = 1;

// ===== ASSIGNMENT ENDPOINTS =====

app.post('/api/assignments', (req, res) => {
  const { title, course, dueDate, estimatedHours, priority, instructions } = req.body;
  
  if (!title || !course || !dueDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const assignment = {
    id: id_counter++,
    title,
    course,
    dueDate,
    estimatedHours: estimatedHours || 5,
    priority: priority || 'medium',
    instructions: instructions || '',
    completed: false,
    createdAt: new Date().toISOString()
  };

  assignments.push(assignment);
  res.status(201).json(assignment);
});

app.get('/api/assignments', (req, res) => {
  const sorted = assignments.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  res.json(sorted);
});

app.get('/api/assignments/:id', (req, res) => {
  const assignment = assignments.find(a => a.id === parseInt(req.params.id));
  if (!assignment) return res.status(404).json({ error: 'Not found' });
  res.json(assignment);
});

app.put('/api/assignments/:id', (req, res) => {
  const assignment = assignments.find(a => a.id === parseInt(req.params.id));
  if (!assignment) return res.status(404).json({ error: 'Not found' });

  Object.assign(assignment, req.body);
  res.json(assignment);
});

app.delete('/api/assignments/:id', (req, res) => {
  const idx = assignments.findIndex(a => a.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  
  const deleted = assignments.splice(idx, 1);
  res.json({ deleted: deleted[0] });
});

// Prioritized list
app.get('/api/assignments/prioritized/list', (req, res) => {
  const scored = assignments.map(a => {
    const daysUntilDue = (new Date(a.dueDate) - new Date()) / (1000 * 60 * 60 * 24);
    const urgencyScore = Math.max(0, 10 - daysUntilDue);
    const priorityScore = { high: 3, medium: 2, low: 1 }[a.priority] || 2;
    const totalScore = urgencyScore + priorityScore;
    
    return { ...a, score: totalScore };
  }).sort((a, b) => b.score - a.score);

  res.json(scored);
});

// ===== CALENDAR ENDPOINTS =====

app.post('/api/calendar/events', (req, res) => {
  const { title, startTime, endTime, type } = req.body;
  
  if (!title || !startTime) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const event = {
    id: id_counter++,
    title,
    startTime,
    endTime: endTime || startTime,
    type: type || 'event',
    createdAt: new Date().toISOString()
  };

  calendarEvents.push(event);
  res.status(201).json(event);
});

app.get('/api/calendar/events', (req, res) => {
  const sorted = calendarEvents.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  res.json(sorted);
});

app.delete('/api/calendar/events/:id', (req, res) => {
  const idx = calendarEvents.findIndex(e => e.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  
  const deleted = calendarEvents.splice(idx, 1);
  res.json({ deleted: deleted[0] });
});

// ===== NOTIFICATIONS =====

app.get('/api/notifications', (req, res) => {
  const now = new Date();
  const notifications = [];

  assignments.forEach(a => {
    // Don't show notifications for completed tasks
    if (a.completed) return;
    
    const dueDate = new Date(a.dueDate);
    const daysUntilDue = (dueDate - now) / (1000 * 60 * 60 * 24);
    
    if (daysUntilDue <= 1 && daysUntilDue > 0) {
      notifications.push({
        id: a.id,
        type: 'due_soon',
        message: `${a.title} is due in ${daysUntilDue.toFixed(1)} days`,
        assignment: a
      });
    }
  });

  res.json(notifications);
});

// ===== DEMO DATA LOADER =====

app.post('/api/demo/load', (req, res) => {
  assignments = [];
  calendarEvents = [];
  id_counter = 1;

  // Sample assignments
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in3days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  assignments = [
    {
      id: id_counter++,
      title: 'ETI 421 Project Deliverable 3',
      course: 'ETI 421',
      dueDate: tomorrow.toISOString(),
      estimatedHours: 8,
      priority: 'high',
      instructions: 'Complete prototype and documentation',
      completed: false,
      createdAt: new Date().toISOString()
    },
    {
      id: id_counter++,
      title: 'Linear Algebra Problem Set',
      course: 'MATH 220',
      dueDate: in3days.toISOString(),
      estimatedHours: 4,
      priority: 'medium',
      instructions: 'Chapter 5, problems 1-30',
      completed: false,
      createdAt: new Date().toISOString()
    },
    {
      id: id_counter++,
      title: 'Data Structures Quiz',
      course: 'CMPSC 202',
      dueDate: in7days.toISOString(),
      estimatedHours: 2,
      priority: 'low',
      instructions: 'Study chapters 4-6',
      completed: false,
      createdAt: new Date().toISOString()
    }
  ];

  // Sample calendar events
  calendarEvents = [
    {
      id: id_counter++,
      title: 'ETI 421 Class',
      startTime: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      endTime: new Date(now.getTime() + 3.5 * 60 * 60 * 1000).toISOString(),
      type: 'lecture',
      createdAt: new Date().toISOString()
    }
  ];

  res.json({ message: 'Demo data loaded', assignments, events: calendarEvents });
});

// ===== HEALTH CHECK =====
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve index.html for SPA routing
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`StudySync running on http://localhost:${PORT}`);
});
