const API = `${window.location.origin}/api`;
const STORAGE_KEY = 'studysync.auth.token';

const state = {
  token: localStorage.getItem(STORAGE_KEY) || '',
  user: null,
  assignments: [],
  events: [],
  notifications: [],
  currentTab: 'dashboard'
};

const PAST_DUE_GRACE_MS = 60 * 60 * 1000;

document.addEventListener('DOMContentLoaded', () => {
  setupAuthForms();
  setupNavigation();
  setupForms();
  setupCanvasControls();
  setupThemeToggle();
  setupAuthModeToggle();
  bootstrap();
});

async function bootstrap() {
  if (!state.token) {
    showAuthView();
    return;
  }

  try {
    const session = await api('/auth/session');
    state.user = session.user;
    applyTheme(state.user.theme || 'light');
    showAppView();
    await refreshData();
  } catch (error) {
    clearSession();
    showAuthView();
  }
}

function setupAuthModeToggle() {
  document.querySelectorAll('[data-auth-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.getAttribute('data-auth-mode');
      document.querySelectorAll('[data-auth-mode]').forEach((item) => item.classList.toggle('active', item === button));
      document.querySelectorAll('.auth-form').forEach((form) => form.classList.remove('active'));
      document.getElementById(mode === 'login' ? 'login-form' : 'register-form').classList.add('active');
    });
  });
}

function setupAuthForms() {
  document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      const payload = {
        email: document.getElementById('login-email').value.trim(),
        password: document.getElementById('login-password').value
      };

      const response = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Unable to sign in');
      }

      setSession(data.token, data.user);
      showAppView();
      await refreshData();
      toast('Signed in.');
    } catch (error) {
      toast(error.message, true);
    }
  });

  document.getElementById('register-form').addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      const payload = {
        name: document.getElementById('register-name').value.trim(),
        email: document.getElementById('register-email').value.trim(),
        password: document.getElementById('register-password').value
      };

      const response = await fetch(`${API}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Unable to create account');
      }

      setSession(data.token, data.user);
      showAppView();
      await refreshData();
      toast('Account created.');
    } catch (error) {
      toast(error.message, true);
    }
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch (error) {
      console.error(error);
    }

    clearSession();
    showAuthView();
    toast('Logged out.');
  });
}

function setupNavigation() {
  document.querySelectorAll('.nav-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const tabName = button.getAttribute('data-tab');
      switchTab(tabName);
    });
  });
}

function setupForms() {
  document.getElementById('create-form').addEventListener('submit', async (event) => {
    event.preventDefault();

    const estimatedHours = parseInt(document.getElementById('form-hours').value, 10);
    if (estimatedHours < 1 || estimatedHours > 24) {
      toast('Estimated hours must be between 1 and 24.', true);
      return;
    }

    try {
      await api('/assignments', {
        method: 'POST',
        body: JSON.stringify({
          title: document.getElementById('form-title').value.trim(),
          course: document.getElementById('form-course').value.trim(),
          dueDate: new Date(document.getElementById('form-due-date').value).toISOString(),
          estimatedHours,
          priority: document.getElementById('form-priority').value,
          instructions: document.getElementById('form-instructions').value.trim()
        })
      });

      document.getElementById('create-form').reset();
      toast('Task created.');
      await refreshData();
      switchTab('assignments');
    } catch (error) {
      toast(error.message, true);
    }
  });

  document.getElementById('create-event-form').addEventListener('submit', async (event) => {
    event.preventDefault();

    const start = new Date(document.getElementById('form-event-start').value).toISOString();
    const endValue = document.getElementById('form-event-end').value;
    const end = endValue ? new Date(endValue).toISOString() : start;

    if (new Date(end) < new Date(start)) {
      toast('End time must be after start time.', true);
      return;
    }

    try {
      await api('/calendar/events', {
        method: 'POST',
        body: JSON.stringify({
          title: document.getElementById('form-event-title').value.trim(),
          startTime: start,
          endTime: end,
          type: document.getElementById('form-event-type').value
        })
      });

      document.getElementById('create-event-form').reset();
      toast('Event created.');
      await refreshData();
      switchTab('calendar');
    } catch (error) {
      toast(error.message, true);
    }
  });

  document.getElementById('load-demo').addEventListener('click', async () => {
    try {
      await api('/demo/load', { method: 'POST' });
      await refreshData();
      toast('Demo data loaded.');
    } catch (error) {
      toast(error.message, true);
    }
  });
}

function setupCanvasControls() {
  document.getElementById('canvas-save-btn').addEventListener('click', async () => {
    try {
      const baseUrl = document.getElementById('canvas-base-url').value.trim();
      const apiKey = document.getElementById('canvas-api-key').value.trim();
      await api('/canvas/config', {
        method: 'PUT',
        body: JSON.stringify({ baseUrl, apiKey })
      });
      document.getElementById('canvas-api-key').value = '';
      await loadCanvasStatus();
      toast('Canvas settings saved.');
    } catch (error) {
      toast(error.message, true);
    }
  });

  document.getElementById('canvas-sync-btn').addEventListener('click', async () => {
    const button = document.getElementById('canvas-sync-btn');
    button.disabled = true;
    button.textContent = 'Syncing...';

    try {
      const summary = await api('/canvas/sync', { method: 'POST' });
      toast(`Canvas synced: ${summary.assignments} assignments and ${summary.events} events.`);
      await refreshData();
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = 'Sync Now';
    }
  });
}

function setupThemeToggle() {
  document.getElementById('theme-toggle').addEventListener('click', async () => {
    const nextTheme = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);

    try {
      const response = await api('/profile/preferences', {
        method: 'PUT',
        body: JSON.stringify({ theme: nextTheme })
      });
      state.user = response.user;
    } catch (error) {
      toast(error.message, true);
    }
  });
}

function setSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem(STORAGE_KEY, token);
  applyTheme(user.theme || 'light');
}

function clearSession() {
  state.token = '';
  state.user = null;
  state.assignments = [];
  state.events = [];
  state.notifications = [];
  localStorage.removeItem(STORAGE_KEY);
  applyTheme('light');
}

function showAuthView() {
  document.getElementById('auth-view').classList.remove('hidden');
  document.getElementById('app-view').classList.add('hidden');
}

function showAppView() {
  document.getElementById('auth-view').classList.add('hidden');
  document.getElementById('app-view').classList.remove('hidden');
}

function switchTab(tabName) {
  state.currentTab = tabName;
  document.querySelectorAll('.tab-content').forEach((tab) => tab.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((button) => {
    button.classList.toggle('active', button.getAttribute('data-tab') === tabName);
  });

  const target = document.getElementById(tabName);
  if (target) {
    target.classList.add('active');
  }
}

async function refreshData() {
  const [assignments, events, notifications] = await Promise.all([
    api('/assignments'),
    api('/calendar/events'),
    api('/notifications')
  ]);

  state.assignments = assignments;
  state.events = events;
  state.notifications = notifications;

  document.getElementById('welcome-copy').textContent = `Signed in as ${state.user.name} (${state.user.email})`;

  await loadCanvasStatus();
  renderAssignments();
  renderPrioritized();
  renderCalendar();
  renderDashboard();
}

async function loadCanvasStatus() {
  try {
    const status = await api('/canvas/status');
    document.getElementById('canvas-base-url').value = status.baseUrl || '';
    document.getElementById('canvas-api-key').value = '';

    let message = status.hasUserToken
      ? 'Your personal Canvas token is saved server-side.'
      : status.hasServerToken
        ? 'Using the server Canvas token.'
        : 'No Canvas token is saved yet.';

    if (status.baseUrl) {
      message += ` URL saved: ${status.baseUrl}`;
    }

    if (status.lastSyncedAt && status.lastSyncSummary) {
      message += ` Last sync ${formatDateTime(status.lastSyncedAt)} for ${status.lastSyncSummary.assignments} assignments and ${status.lastSyncSummary.events} events.`;
    }

    document.getElementById('canvas-status').textContent = message;
  } catch (error) {
    document.getElementById('canvas-status').textContent = 'Unable to load Canvas configuration.';
  }
}

function renderAssignments() {
  const container = document.getElementById('assignments-list');
  const visibleAssignments = getVisibleAssignments();

  if (visibleAssignments.length === 0) {
    container.innerHTML = emptyState('No assignments yet', 'Create one manually or import from Canvas.');
    return;
  }

  container.innerHTML = visibleAssignments.map((assignment) => createAssignmentCard(assignment)).join('');
}

function renderPrioritized() {
  const prioritized = getVisibleAssignments()
    .filter((assignment) => !assignment.completed)
    .map((assignment) => ({
      ...assignment,
      score:
        Math.max(0, 10 - Math.max(0, (new Date(assignment.dueDate) - new Date()) / (1000 * 60 * 60 * 24))) +
        ({ high: 3, medium: 2, low: 1 }[assignment.priority] || 2)
    }))
    .sort((a, b) => b.score - a.score);

  const container = document.getElementById('prioritized-list');
  if (prioritized.length === 0) {
    container.innerHTML = emptyState('Nothing pending', 'You are caught up.');
    return;
  }

  container.innerHTML = prioritized.map((assignment) => createAssignmentCard(assignment, true)).join('');
}

function renderCalendar() {
  const container = document.getElementById('calendar-list');
  const calendarItems = getCalendarItems();

  if (calendarItems.length === 0) {
    container.innerHTML = emptyState('No upcoming items', 'Add an event or sync Canvas to populate the schedule.');
    return;
  }

  container.innerHTML = calendarItems
    .map(
      (item) => `
        <article class="event-card">
          <div class="card-row">
            <div>
              <div class="event-title">${escapeHtml(item.title)}</div>
              <div class="event-time">${item.kind === 'assignment'
                ? `${formatDateTime(item.startTime)} | Due date`
                : `${formatDate(item.startTime)} | ${formatTime(item.startTime)} to ${formatTime(item.endTime)}`}</div>
            </div>
            <div class="assignment-actions">
              <span class="assignment-badge badge-source">${item.kind === 'assignment' ? 'assignment' : (item.source || 'manual')}</span>
              ${item.kind === 'assignment'
                ? `<button class="btn btn-secondary" type="button" onclick="switchTab('assignments')">View Task</button>`
                : item.source === 'manual'
                  ? `<button class="btn btn-danger" type="button" onclick="deleteEvent(${item.id})">Delete</button>`
                  : ''}
            </div>
          </div>
        </article>
      `
    )
    .join('');
}

function renderDashboard() {
  const visibleAssignments = getVisibleAssignments();
  const completed = state.assignments.filter((assignment) => assignment.completed).length;
  const dueSoon = state.notifications.length;

  document.getElementById('stat-total').textContent = `${visibleAssignments.filter((assignment) => !assignment.completed).length}`;
  document.getElementById('stat-completed').textContent = `${completed}`;
  document.getElementById('stat-due-soon').textContent = `${dueSoon}`;

  const notifications = document.getElementById('notifications-widget');
  notifications.innerHTML = state.notifications.length
    ? state.notifications
        .map(
          (notification) => `
            <div class="stack-item accent-warn">
              <strong>${escapeHtml(notification.assignment.title)}</strong>
              <p>${escapeHtml(notification.message)}</p>
            </div>
          `
        )
        .join('')
    : emptyState('All clear', 'No urgent assignment deadlines in the next 24 hours.');

  const topPriority = visibleAssignments
    .filter((assignment) => !assignment.completed)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0];

  document.getElementById('top-priority').innerHTML = topPriority
    ? `
      <div class="stack-item accent-danger">
        <strong>${escapeHtml(topPriority.title)}</strong>
        <p>${escapeHtml(topPriority.course)} | Due ${formatDateTime(topPriority.dueDate)}</p>
      </div>
    `
    : emptyState('Nothing pressing', 'Completed work will clear from this panel.');

  const upcomingEvents = getCalendarItems().slice(0, 3);
  document.getElementById('dashboard-events').innerHTML = upcomingEvents.length
    ? upcomingEvents
        .map(
          (event) => `
            <div class="stack-item">
              <strong>${escapeHtml(event.title)}</strong>
              <p>${event.kind === 'assignment' ? `${formatDateTime(event.startTime)} | Due date` : `${formatDate(event.startTime)} | ${formatTime(event.startTime)}`}</p>
            </div>
          `
        )
        .join('')
    : emptyState('No scheduled events', 'Use the calendar tab or sync Canvas to populate this.');
}

function createAssignmentCard(assignment, showScore = false) {
  const timeUntilDue = new Date(assignment.dueDate) - new Date();
  const dueSoon = timeUntilDue <= 24 * 60 * 60 * 1000 && timeUntilDue >= 0;
  const preview = createInstructionPreview(assignment.instructions);

  return `
    <article class="assignment-card ${assignment.completed ? 'completed' : ''} ${assignment.priority}-priority">
      <div class="assignment-info">
        <div class="card-row">
          <h3 class="assignment-title">${escapeHtml(assignment.title)}</h3>
          <div class="assignment-actions">
            <span class="assignment-badge badge-${assignment.priority}">${assignment.priority}</span>
            <span class="assignment-badge badge-source">${escapeHtml(assignment.source || 'manual')}</span>
            ${showScore ? `<span class="assignment-badge badge-score">${assignment.score.toFixed(1)}</span>` : ''}
          </div>
        </div>
        <p class="assignment-meta">${escapeHtml(assignment.course)} | Due ${formatDateTime(assignment.dueDate)} | ${assignment.estimatedHours || 0}h</p>
        ${preview ? `<p class="assignment-body">${escapeHtml(preview)}</p>` : ''}
        <div class="assignment-footer">
          ${assignment.htmlUrl ? `<a class="text-link" href="${assignment.htmlUrl}" target="_blank" rel="noreferrer">Open in Canvas</a>` : '<span></span>'}
          ${dueSoon && !assignment.completed ? '<span class="urgent-chip">Due soon</span>' : ''}
        </div>
      </div>
      <div class="assignment-actions">
        ${assignment.completed ? '' : `<button class="btn btn-success" type="button" onclick="completeAssignment(${assignment.id})">Mark Done</button>`}
        <button class="btn btn-danger" type="button" onclick="deleteAssignment(${assignment.id}, '${assignment.source || 'manual'}')">Delete</button>
      </div>
    </article>
  `;
}

window.completeAssignment = async function completeAssignment(id) {
  try {
    await api(`/assignments/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ completed: true })
    });
    await refreshData();
    toast('Task updated.');
  } catch (error) {
    toast(error.message, true);
  }
};

window.deleteAssignment = async function deleteAssignment(id, source) {
  if (source === 'canvas' && !window.confirm('Delete this imported item from your StudySync view? It will return on the next Canvas sync if it still exists there.')) {
    return;
  }

  if (source !== 'canvas' && !window.confirm('Delete this task?')) {
    return;
  }

  try {
    await api(`/assignments/${id}`, { method: 'DELETE' });
    await refreshData();
    toast('Task deleted.');
  } catch (error) {
    toast(error.message, true);
  }
};

window.deleteEvent = async function deleteEvent(id) {
  if (!window.confirm('Delete this event?')) {
    return;
  }

  try {
    await api(`/calendar/events/${id}`, { method: 'DELETE' });
    await refreshData();
    toast('Event deleted.');
  } catch (error) {
    toast(error.message, true);
  }
};

window.switchTab = switchTab;

async function api(endpoint, options = {}) {
  const response = await fetch(`${API}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });

  if (response.status === 401) {
    clearSession();
    showAuthView();
    throw new Error('Your session expired. Sign in again.');
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  document.getElementById('theme-toggle').textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function formatTime(dateString) {
  return new Date(dateString).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  });
}

function formatDateTime(dateString) {
  return new Date(dateString).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function emptyState(title, text) {
  return `<div class="empty-state"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></div>`;
}

function toast(message, isError = false) {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.classList.remove('hidden', 'error');
  if (isError) {
    node.classList.add('error');
  }

  clearTimeout(toast.timeoutId);
  toast.timeoutId = setTimeout(() => node.classList.add('hidden'), 3200);
}

function escapeHtml(value = '') {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sanitizeText(value = '') {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function stripHtml(value = '') {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function createInstructionPreview(value = '') {
  const plain = stripHtml(value);
  if (!plain) {
    return '';
  }

  return plain.length > 220 ? `${plain.slice(0, 217)}...` : plain;
}

function isPastDue(assignment) {
  return new Date(assignment.dueDate).getTime() < Date.now() - PAST_DUE_GRACE_MS;
}

function getVisibleAssignments() {
  return state.assignments.filter((assignment) => !isPastDue(assignment));
}

function getCalendarItems() {
  const upcomingEvents = state.events
    .filter((event) => new Date(event.endTime || event.startTime).getTime() >= Date.now() - PAST_DUE_GRACE_MS)
    .map((event) => ({ ...event, kind: 'event' }));

  const assignmentDates = getVisibleAssignments()
    .filter((assignment) => !assignment.completed)
    .map((assignment) => ({
      id: `assignment-${assignment.id}`,
      title: assignment.title,
      startTime: assignment.dueDate,
      endTime: assignment.dueDate,
      source: assignment.source,
      kind: 'assignment'
    }));

  return [...assignmentDates, ...upcomingEvents].sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
}
