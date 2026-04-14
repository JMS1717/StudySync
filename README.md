# StudySync 📚 - Full Stack Student Task Manager

A complete web application for college students to organize assignments, track priorities, and manage deadlines across all courses.

## Features

✅ **Assignment Management** - Create, edit, delete, and track assignments  
✅ **Smart Prioritization** - Automatic scoring based on urgency + priority  
✅ **Calendar Integration** - Link events with assignments  
✅ **Real-time Dashboard** - See stats, notifications, and top tasks  
✅ **Responsive Design** - Works on desktop and mobile  
✅ **One-Click Demo** - Load sample data instantly  

## Quick Start

### Prerequisites
- Node.js v14+
- npm

### Installation & Run

```bash
tar -xzf studysync.tar.gz
cd studysync
npm install
npm start
```

**Open browser:** `http://localhost:3000`

That's it! 🚀

## How to Use

### 1. Load Demo Data (Optional)
Click "Load Demo Data" on the Create Task tab to populate with sample assignments.

### 2. Create a Task
Go to **Create Task** tab and fill in:
- **Task Title** (e.g., "ETI 421 Project")
- **Course Code** (e.g., "ETI 421")
- **Due Date** (click calendar to select)
- **Priority** (Low / Medium / High)
- **Estimated Hours** (how long it'll take)
- **Instructions** (optional details)

Click "Create Task" → Done!

### 3. View All Tasks
**All Tasks tab** shows everything sorted by due date.

### 4. See Prioritized List
**Prioritized tab** uses the smart algorithm to show which tasks need attention first.

**Priority Score Formula:**
```
Score = (10 - days_until_due) + priority_value
        high=3, medium=2, low=1
```

Example:
- Task due in 2 days, priority=high → score = 8 + 3 = **11** (do this first!)
- Task due in 8 days, priority=low → score = 2 + 1 = **3** (can wait)

### 5. Dashboard
**Dashboard tab** shows:
- Total tasks count
- Completed tasks count
- Tasks due in 24 hours (urgent!)
- Notifications panel
- Your top priority task right now

### 6. Mark Tasks Done
Click the green **✓ Done** button to mark a task complete.

### 7. Delete Tasks
Click **Delete** to remove a task permanently.

## API Endpoints (For Developers)

### Assignments
```bash
# Create assignment
POST /api/assignments
{ "title": "...", "course": "...", "dueDate": "...", "priority": "high" }

# Get all assignments
GET /api/assignments

# Get prioritized list
GET /api/assignments/prioritized/list

# Update assignment
PUT /api/assignments/:id
{ "completed": true }

# Delete assignment
DELETE /api/assignments/:id
```

### Calendar
```bash
# Add event
POST /api/calendar/events
{ "title": "...", "startTime": "...", "type": "lecture" }

# Get events
GET /api/calendar/events
```

### Notifications
```bash
# Get pending alerts (due within 24h)
GET /api/notifications
```

## Project Structure

```
studysync/
├── src/
│   └── server.js          # Express backend + API
├── public/
│   ├── index.html         # Main page
│   ├── css/
│   │   └── style.css      # Styling
│   └── js/
│       └── app.js         # Frontend logic
├── package.json
├── README.md
└── DEVELOPER_GUIDE.md
```

## Development

### Edit Frontend
- **HTML**: `public/index.html`
- **CSS**: `public/css/style.css`
- **JavaScript**: `public/js/app.js`

### Edit Backend
- **API**: `src/server.js`

Changes are live after restart:
```bash
npm run dev  # auto-reloads on file changes
```

## Production Roadmap

### Phase 1 (Current)
✅ Full-stack web app  
✅ In-memory storage  
✅ REST API  
✅ Priority engine  

### Phase 2
- [ ] PostgreSQL database
- [ ] User authentication
- [ ] Multi-user support

### Phase 3
- [ ] Canvas/Blackboard LMS integration
- [ ] Email notifications
- [ ] Google Calendar sync

### Phase 4
- [ ] Mobile app (React Native)
- [ ] WebSocket real-time sync
- [ ] Advanced analytics

## Troubleshooting

**Q: Port 3000 already in use?**
```bash
PORT=8080 npm start
```

**Q: Data disappears after restart?**
That's normal—it's stored in memory. To persist data, replace the in-memory arrays with a database (see DEVELOPER_GUIDE.md).

**Q: How do I deploy this?**
See DEVELOPER_GUIDE.md for production setup (database, auth, etc.).

## Team

Built by the StudySync team for ETI 421 Systems Integration project.

---

**Ready to stay organized?** Start managing your tasks now! 📚
