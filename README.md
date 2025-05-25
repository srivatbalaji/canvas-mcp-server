# Canvas MCP Server

This is the MCP server I built to be used with BruinLearn (Canvas). Feel free to run with any client and modify code to work with your school's Canvas instructure!

## Setup

1. **Get your Canvas access token:**
   - Go to https://bruinlearn.ucla.edu/profile/settings
   - Scroll to "Approved Integrations" 
   - Click "+ New Access Token"
   - Copy the token immediately

2. **Install and configure:**
```bash
git clone https://github.com/srivatbalaji/canvas-mcp-server.git
cd canvas-mcp-server
npm install
echo "CANVAS_ACCESS_TOKEN=your_token_here" > .env
npm run build
```

3. **Configure Claude Desktop:**
   - Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
   - Add this configuration:
```json
{
  "mcpServers": {
    "canvas": {
      "command": "node",
      "args": ["/absolute/path/to/canvas-mcp-server/build/index.js"],
      "env": {
        "CANVAS_ACCESS_TOKEN": "your_canvas_token_here"
      }
    }
  }
}
```

4. **Restart Claude Desktop**

## Usage

Ask Claude about your academic data:
- "What assignments do I have due this week?"
- "Show me my current grades"
- "Which course needs attention?"
- "Find assignments with 'midterm' in the name"

## Available Tools

- `get_courses` - List all enrolled courses
- `get_assignments` - Get assignments by course
- `get_upcoming_assignments` - Show upcoming deadlines  
- `get_grades` - Retrieve grade information
- `get_course_progress` - Detailed course progress
- `search_assignments` - Search assignments by keyword

## Development

```bash
npm run dev    # Development mode
npm run build  # Build for production
npm start      # Start the server
```

## Security

- Never commit your `.env` file
- Rotate Canvas tokens regularly
- Keep tokens private
