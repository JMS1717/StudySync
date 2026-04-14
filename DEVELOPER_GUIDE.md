# StudySync Developer Guide

## Architecture

```
Browser (React SPA)
    ↓ (HTTP/JSON)
Express Server (Port 3000)
    ├─ Static Files (public/)
    └─ REST API (/api/*)
         ↓
    In-Memory Store (assignments, events)
```

## File Structure

```
studysync/
├── src/
│   └── server.js              # Express backend
├── public/
│   ├── index.html             # Single Page App
│   ├── css/
│   │   └── style.css          # Responsive styling
│   └── js/
│       └── app.js             # Frontend logic (vanilla JS)
├── package.json               # Dependencies
├── .env.example               # Environment template
├── README.md                  # User docs
└── DEVELOPER_GUIDE.md         # This file
```

## Backend (Express.js)

### Key Features

1. **Static File Serving** - Serves `public/` directory
2. **REST API** - `/api/*` endpoints for CRUD operations
3. **CORS** - Enables cross-origin requests
4. **In-Memory Storage** - Arrays for assignments and calendar events

### API Endpoints

#### Assignments
- `POST /api/assignments` - Create
- `GET /api/assignments` - List all (sorted by due date)
- `GET /api/assignments/:id` - Get single
- `PUT /api/assignments/:id` - Update
- `DELETE /api/assignments/:id` - Delete
- `GET /api/assignments/prioritized/list` - Smart sort

#### Calendar
- `POST /api/calendar/events` - Create event
- `GET /api/calendar/events` - List events

#### Utilities
- `GET /api/notifications` - Get urgent tasks (due <24h)
- `POST /api/demo/load` - Load sample data
- `GET /api/health` - Server status

### Prioritization Algorithm

```javascript
const daysUntilDue = (new Date(dueDate) - now) / (1000 * 60 * 60 * 24);
const urgencyScore = Math.max(0, 10 - daysUntilDue);
const priorityScore = { high: 3, medium: 2, low: 1 }[priority];
const totalScore = urgencyScore + priorityScore;
```

**Logic:**
- Tasks due sooner = higher urgency score
- Manual priority adds fixed multiplier
- Tasks sorted by total score (highest first)

## Frontend (Vanilla JavaScript)

### Key Components

1. **Tab Navigation** - Switch between views
2. **Form Handler** - Create new assignments
3. **Real-time Rendering** - Update UI from API data
4. **Auto-Refresh** - Polls API every 5 seconds
5. **Dashboard** - Stats and top priorities

### File: `public/js/app.js`

**Main Functions:**
- `loadInitialData()` - Fetch data on page load
- `refreshData()` - Poll API every 5 seconds
- `loadAssignments()` - Get all tasks
- `loadPrioritized()` - Get smart sorted list
- `renderAssignments()` - Draw assignment cards
- `updateDashboard()` - Update stats/notifications
- `completeAssignment(id)` - Mark done
- `deleteAssignment(id)` - Remove task

### API Calls Flow

```
User Action (click, submit)
    ↓
JavaScript Handler
    ↓
fetch() → /api/assignments (or other endpoint)
    ↓
Backend processes
    ↓
JSON response
    ↓
refreshData() → Re-render UI
```

## Development Workflow

### Add a New Feature

**Example: Add course filtering**

1. **Backend** (`src/server.js`):
```javascript
// Add endpoint to get assignments by course
app.get('/api/assignments/course/:code', (req, res) => {
  const { code } = req.params;
  const filtered = assignments.filter(a => a.course === code);
  res.json(filtered);
});
```

2. **Frontend** (`public/js/app.js`):
```javascript
// Add function to load by course
async function loadByCourse(courseCode) {
  const res = await fetch(`${API}/assignments/course/${courseCode}`);
  const data = await res.json();
  renderAssignments();
}

// Add UI button/dropdown
```

3. **HTML** (`public/index.html`):
```html
<select id="course-filter" onchange="filterByCourse(this.value)">
  <option value="">All Courses</option>
  <option value="ETI 421">ETI 421</option>
  <option value="MATH 141">MATH 141</option>
</select>
```

### Testing Locally

**Create assignment via curl:**
```bash
curl -X POST http://localhost:3000/api/assignments \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Task",
    "course": "TEST 101",
    "dueDate": "2026-04-10T23:59:59Z",
    "priority": "high"
  }'
```

**Get prioritized list:**
```bash
curl http://localhost:3000/api/assignments/prioritized/list | jq
```

**Load demo data:**
```bash
curl -X POST http://localhost:3000/api/demo/load
```

## Production Deployment

### Before Going Live

#### 1. Add Database
Replace in-memory arrays with PostgreSQL:

```javascript
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

app.get('/api/assignments', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM assignments ORDER BY due_date');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});
```

#### 2. Add Authentication
Use JWT tokens:

```javascript
const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ error: 'Invalid token' });
  }
}

app.get('/api/assignments', authMiddleware, async (req, res) => {
  // Only return user's assignments
});
```

#### 3. Environment Variables
```bash
# .env (production)
PORT=3000
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@host:5432/studysync
JWT_SECRET=your-secret-key
CORS_ORIGIN=https://yourdomain.com
```

#### 4. Error Handling
Add try-catch around async operations:

```javascript
app.post('/api/assignments', async (req, res) => {
  try {
    // validate input
    // database operation
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

#### 5. Deployment Options

**Heroku:**
```bash
heroku create studysync
git push heroku main
heroku config:set DATABASE_URL=postgresql://...
```

**AWS/DigitalOcean:**
- Provision VM + Node.js
- Install PostgreSQL
- Clone repo, install deps
- Use PM2 for process management

**Docker:**
```dockerfile
FROM node:18
WORKDIR /app
COPY . .
RUN npm install
EXPOSE 3000
CMD ["npm", "start"]
```

## Performance Tips

1. **Add Database Indexing** - Index `due_date` and `user_id`
2. **Implement Caching** - Cache prioritized list
3. **Pagination** - Return 20 tasks per page instead of all
4. **Lazy Load** - Load calendar events only when needed

## Roadmap

- [ ] User authentication (Phase 2)
- [ ] Multi-user support (Phase 2)
- [ ] Database persistence (Phase 2)
- [ ] Canvas LMS integration (Phase 3)
- [ ] Email notifications (Phase 3)
- [ ] Google Calendar sync (Phase 3)
- [ ] Mobile app (Phase 4)
- [ ] Advanced analytics (Phase 4)

---

**Questions?** Check the README.md or inspect the code. It's well-commented!
