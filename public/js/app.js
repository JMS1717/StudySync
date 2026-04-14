const API = 'http://localhost:3000/api';

// ===== STATE =====
let assignments = [];
let events = [];

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  setupTabNavigation();
  setupFormHandlers();
  loadInitialData();
  setInterval(refreshData, 5000); // Refresh every 5 seconds
});

// ===== TAB NAVIGATION =====
function setupTabNavigation() {
  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.getAttribute('data-tab');
      switchTab(tabName);
    });
  });
}

function switchTab(tabName) {
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });
  
  // Show selected tab
  const targetTab = document.getElementById(tabName);
  if (targetTab) targetTab.classList.add('active');

  // Update nav buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('data-tab') === tabName) {
      btn.classList.add('active');
    }
  });

  // Load tab data
  if (tabName === 'assignments') loadAssignments();
  if (tabName === 'prioritized') loadPrioritized();
  if (tabName === 'calendar') loadCalendar();
}

// ===== FORM HANDLERS =====
function setupFormHandlers() {
  document.getElementById('create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const title = document.getElementById('form-title').value.trim();
    const course = document.getElementById('form-course').value.trim();
    const dueDateStr = document.getElementById('form-due-date').value;
    const priority = document.getElementById('form-priority').value;
    const estimatedHours = parseInt(document.getElementById('form-hours').value);
    const instructions = document.getElementById('form-instructions').value.trim();

    // Validation
    if (!title || !course || !dueDateStr) {
      alert('❌ Please fill in all required fields');
      return;
    }

    if (estimatedHours < 1 || estimatedHours > 24) {
      alert('❌ Estimated hours must be between 1 and 24');
      return;
    }

    try {
      const dueDate = new Date(dueDateStr).toISOString();
      
      const res = await fetch(`${API}/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, course, dueDate, priority, estimatedHours, instructions
        })
      });

      if (res.ok) {
        alert('✅ Task created!');
        document.getElementById('create-form').reset();
        refreshData();
      } else {
        const error = await res.json();
        alert(`❌ Error: ${error.error || 'Failed to create task'}`);
      }
    } catch (err) {
      alert('❌ Error creating task: ' + err.message);
      console.error(err);
    }
  });

  // Calendar event form handler
  document.getElementById('create-event-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const title = document.getElementById('form-event-title').value.trim();
    const startTimeStr = document.getElementById('form-event-start').value;
    const endTimeStr = document.getElementById('form-event-end').value;
    const type = document.getElementById('form-event-type').value;

    // Validation
    if (!title || !startTimeStr) {
      alert('❌ Please fill in title and start time');
      return;
    }

    try {
      const startTime = new Date(startTimeStr).toISOString();
      const endTime = endTimeStr ? new Date(endTimeStr).toISOString() : startTime;

      // Validate end time is after start time
      if (new Date(endTime) < new Date(startTime)) {
        alert('❌ End time must be after start time');
        return;
      }

      const res = await fetch(`${API}/calendar/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, startTime, endTime, type
        })
      });

      if (res.ok) {
        alert('✅ Event added!');
        document.getElementById('create-event-form').reset();
        loadCalendar();
      } else {
        const error = await res.json();
        alert(`❌ Error: ${error.error || 'Failed to add event'}`);
      }
    } catch (err) {
      alert('❌ Error adding event: ' + err.message);
      console.error(err);
    }
  });

  document.getElementById('load-demo').addEventListener('click', async () => {
    try {
      const res = await fetch(`${API}/demo/load`, { method: 'POST' });
      if (res.ok) {
        alert('✅ Demo data loaded!');
        refreshData();
      } else {
        alert('❌ Failed to load demo data');
      }
    } catch (err) {
      alert('❌ Error loading demo data: ' + err.message);
      console.error(err);
    }
  });
}

// ===== DATA LOADING =====
async function loadInitialData() {
  await loadAssignments();
  await loadCalendar();
  updateDashboard();
}

async function refreshData() {
  await loadAssignments();
  await loadCalendar();
  updateDashboard();
}

async function loadAssignments() {
  try {
    const res = await fetch(`${API}/assignments`);
    assignments = await res.json();
    renderAssignments();
  } catch (err) {
    console.error('Failed to load assignments:', err);
  }
}

async function loadPrioritized() {
  try {
    const res = await fetch(`${API}/assignments/prioritized/list`);
    const prioritized = await res.json();
    renderPrioritized(prioritized);
  } catch (err) {
    console.error('Failed to load prioritized list:', err);
  }
}

async function loadCalendar() {
  try {
    const res = await fetch(`${API}/calendar/events`);
    events = await res.json();
    renderCalendar();
  } catch (err) {
    console.error('Failed to load calendar:', err);
  }
}

// ===== RENDERING =====
function renderAssignments() {
  const container = document.getElementById('assignments-list');
  
  if (assignments.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>No tasks yet</h3></div>';
    return;
  }

  container.innerHTML = assignments.map(a => createAssignmentCard(a)).join('');
  setupAssignmentHandlers();
}

function renderPrioritized(prioritized) {
  const container = document.getElementById('prioritized-list');
  
  // Filter out completed tasks
  const incomplete = prioritized.filter(a => !a.completed);
  
  if (incomplete.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>No pending tasks</h3></div>';
    return;
  }

  container.innerHTML = incomplete.map(a => createAssignmentCard(a, true)).join('');
  setupAssignmentHandlers();
}

function renderCalendar() {
  const container = document.getElementById('calendar-list');
  
  if (events.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>No events yet</h3></div>';
    return;
  }

  container.innerHTML = events.map(e => `
    <div class="event-card">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div class="event-title">${e.title}</div>
          <div class="event-time">${formatDate(e.startTime)} ${formatTime(e.startTime)} - ${formatTime(e.endTime)}</div>
          <div style="margin-top: 8px; font-size: 0.9rem; color: #999;">Type: ${e.type}</div>
        </div>
        <button class="btn btn-danger" onclick="deleteEvent(${e.id})" style="margin-left: 10px;">Delete</button>
      </div>
    </div>
  `).join('');
}

function createAssignmentCard(a, showScore = false) {
  const daysUntilDue = (new Date(a.dueDate) - new Date()) / (1000 * 60 * 60 * 24);
  const isUrgent = daysUntilDue <= 1 && daysUntilDue > 0;
  
  return `
    <div class="assignment-card ${a.completed ? 'completed' : ''} ${a.priority}-priority">
      <div class="assignment-info">
        <div class="assignment-title">${a.title}</div>
        <div class="assignment-meta">
          <span>📚 ${a.course}</span>
          <span>⏰ ${formatDate(a.dueDate)}</span>
          <span>${a.estimatedHours}h</span>
          <span class="assignment-badge badge-${a.priority}">${a.priority.toUpperCase()}</span>
          ${showScore ? `<span class="assignment-badge badge-score">Score: ${a.score.toFixed(1)}</span>` : ''}
          ${isUrgent ? '<span style="color: red; font-weight: bold;">🔴 DUE SOON</span>' : ''}
        </div>
      </div>
      <div class="assignment-actions">
        <button class="btn btn-success" onclick="completeAssignment(${a.id})">✓ Done</button>
        <button class="btn btn-danger" onclick="deleteAssignment(${a.id})">Delete</button>
      </div>
    </div>
  `;
}

async function completeAssignment(id) {
  try {
    await fetch(`${API}/assignments/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: true })
    });
    refreshData();
  } catch (err) {
    console.error(err);
  }
}

async function deleteAssignment(id) {
  if (confirm('Are you sure you want to delete this task?')) {
    try {
      const res = await fetch(`${API}/assignments/${id}`, { method: 'DELETE' });
      if (res.ok) {
        refreshData();
      } else {
        alert('❌ Failed to delete task');
      }
    } catch (err) {
      alert('❌ Error deleting task: ' + err.message);
      console.error(err);
    }
  }
}

async function deleteEvent(id) {
  if (confirm('Are you sure you want to delete this event?')) {
    try {
      const res = await fetch(`${API}/calendar/events/${id}`, { method: 'DELETE' });
      if (res.ok) {
        loadCalendar();
      } else {
        alert('❌ Failed to delete event');
      }
    } catch (err) {
      alert('❌ Error deleting event: ' + err.message);
      console.error(err);
    }
  }
}

// ===== DASHBOARD =====
async function updateDashboard() {
  const total = assignments.length;
  const completed = assignments.filter(a => a.completed).length;
  
  try {
    const res = await fetch(`${API}/notifications`);
    const notifications = await res.json();
    
    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-completed').textContent = completed;
    document.getElementById('stat-due-soon').textContent = notifications.length;

    // Notifications widget
    const notifContainer = document.getElementById('notifications-widget');
    if (notifications.length === 0) {
      notifContainer.innerHTML = '<p style="color: #999;">All clear! ✨</p>';
    } else {
      notifContainer.innerHTML = notifications.map(n => `
        <div style="padding: 10px; background: #fef3c7; border-radius: 6px; margin-bottom: 8px;">
          <div style="font-weight: 500;">${n.assignment.title}</div>
          <div style="font-size: 0.9rem; color: #666;">${n.message}</div>
        </div>
      `).join('');
    }

    // Top priority
    const prioritized = assignments.filter(a => !a.completed).sort((a, b) => {
      const scoreA = (10 - ((new Date(a.dueDate) - new Date()) / (1000 * 60 * 60 * 24))) + ({ high: 3, medium: 2, low: 1 }[a.priority] || 2);
      const scoreB = (10 - ((new Date(b.dueDate) - new Date()) / (1000 * 60 * 60 * 24))) + ({ high: 3, medium: 2, low: 1 }[b.priority] || 2);
      return scoreB - scoreA;
    });

    const topPriorityContainer = document.getElementById('top-priority');
    if (prioritized.length === 0) {
      topPriorityContainer.innerHTML = '<p style="color: #999;">All tasks complete! 🎉</p>';
    } else {
      const top = prioritized[0];
      topPriorityContainer.innerHTML = `
        <div style="padding: 10px; background: #fee2e2; border-radius: 6px;">
          <div style="font-weight: 500;">${top.title}</div>
          <div style="font-size: 0.9rem; color: #666;">Due: ${formatDate(top.dueDate)}</div>
        </div>
      `;
    }
  } catch (err) {
    console.error(err);
  }
}

// ===== UTILITIES =====
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(dateString) {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function setupAssignmentHandlers() {
  // Handlers are inline in HTML
}
