#!/usr/bin/env node

import dotenv from 'dotenv';
dotenv.config();

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

//canvas API configuration
const CANVAS_BASE_URL = 'https://bruinlearn.ucla.edu'; //feel free to change this to your Canvas instance!
const API_VERSION = 'v1';

interface CanvasConfig {
  baseUrl: string;
  accessToken: string;
}

interface Assignment {
  id: number;
  name: string;
  due_at: string | null;
  points_possible: number;
  submission_types: string[];
  course_id: number;
  html_url: string;
}

interface Course {
  id: number;
  name: string;
  course_code: string;
  enrollment_term_id: number;
}

interface Grade {
  assignment_id: number;
  assignment: Assignment;
  score: number | null;
  grade: string | null;
  submission: any;
}

//if you're reading this shoot me an email and ask me any questions! srivatbalaji[at]ucla.edu lol

class CanvasMCPServer {
  private server: Server;
  private config: CanvasConfig;

  constructor() {
    this.config = {
      baseUrl: process.env.CANVAS_BASE_URL || CANVAS_BASE_URL,
      accessToken: process.env.CANVAS_ACCESS_TOKEN || '',
    };

    if (!this.config.accessToken) {
      throw new Error('CANVAS_ACCESS_TOKEN environment variable is required');
    }

    this.server = new Server(
      {
        name: 'canvas-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  private async makeCanvasRequest(endpoint: string): Promise<any> {
    const url = `${this.config.baseUrl}/api/${API_VERSION}${endpoint}`;
    
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Canvas API error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to fetch from Canvas: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'get_courses',
            description: 'Get all enrolled courses',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'get_assignments',
            description: 'Get assignments for a specific course or all courses',
            inputSchema: {
              type: 'object',
              properties: {
                course_id: {
                  type: 'number',
                  description: 'Course ID (optional - if not provided, gets all assignments)',
                },
                include_completed: {
                  type: 'boolean',
                  description: 'Include completed assignments (default: false)',
                  default: false,
                },
              },
            },
          },
          {
            name: 'get_upcoming_assignments',
            description: 'Get upcoming assignments with deadlines',
            inputSchema: {
              type: 'object',
              properties: {
                days_ahead: {
                  type: 'number',
                  description: 'Number of days to look ahead (default: 7)',
                  default: 7,
                },
              },
            },
          },
          {
            name: 'get_grades',
            description: 'Get grades for a specific course or all courses',
            inputSchema: {
              type: 'object',
              properties: {
                course_id: {
                  type: 'number',
                  description: 'Course ID (optional - if not provided, gets all grades)',
                },
              },
            },
          },
          {
            name: 'get_course_progress',
            description: 'Get detailed progress information for a course',
            inputSchema: {
              type: 'object',
              properties: {
                course_id: {
                  type: 'number',
                  description: 'Course ID',
                },
              },
              required: ['course_id'],
            },
          },
          {
            name: 'search_assignments',
            description: 'Search for assignments by name or keyword',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query',
                },
              },
              required: ['query'],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'get_courses':
            return await this.getCourses();
          
          case 'get_assignments':
            return await this.getAssignments(
              args?.course_id as number | undefined, 
              args?.include_completed as boolean | undefined
            );
          
          case 'get_upcoming_assignments':
            return await this.getUpcomingAssignments((args?.days_ahead as number) || 7);
          
          case 'get_grades':
            return await this.getGrades(args?.course_id as number | undefined);
          
          case 'get_course_progress':
            return await this.getCourseProgress(args?.course_id as number);
          
          case 'search_assignments':
            return await this.searchAssignments(args?.query as string);
          
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Error executing ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });
  }

  private async getCourses() {
    const courses = await this.makeCanvasRequest('/courses?enrollment_state=active&per_page=100');
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            courses: courses.map((course: Course) => ({
              id: course.id,
              name: course.name,
              code: course.course_code,
            })),
          }, null, 2),
        },
      ],
    };
  }

  private async getAssignments(courseId?: number, includeCompleted: boolean = false) {
    let assignments: Assignment[] = [];

    if (courseId) {
      assignments = await this.makeCanvasRequest(`/courses/${courseId}/assignments?per_page=100`);
    } else {
      const courses = await this.makeCanvasRequest('/courses?enrollment_state=active&per_page=100');
      for (const course of courses) {
        const courseAssignments = await this.makeCanvasRequest(`/courses/${course.id}/assignments?per_page=100`);
        assignments.push(...courseAssignments.map((a: Assignment) => ({ ...a, course_name: course.name })));
      }
    }

    if (!includeCompleted) {
      const now = new Date();
      assignments = assignments.filter(assignment => {
        if (!assignment.due_at) return true;
        return new Date(assignment.due_at) >= now;
      });
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            assignments: assignments.map(assignment => ({
              id: assignment.id,
              name: assignment.name,
              due_date: assignment.due_at,
              points: assignment.points_possible,
              course_id: assignment.course_id,
              course_name: (assignment as any).course_name,
              url: assignment.html_url,
            })),
          }, null, 2),
        },
      ],
    };
  }

  private async getUpcomingAssignments(daysAhead: number) {
    const courses = await this.makeCanvasRequest('/courses?enrollment_state=active&per_page=100');
    const now = new Date();
    const cutoffDate = new Date(now.getTime() + (daysAhead * 24 * 60 * 60 * 1000));
    
    let upcomingAssignments: any[] = [];

    for (const course of courses) {
      const assignments = await this.makeCanvasRequest(`/courses/${course.id}/assignments?per_page=100`);
      
      const upcoming = assignments.filter((assignment: Assignment) => {
        if (!assignment.due_at) return false;
        const dueDate = new Date(assignment.due_at);
        return dueDate >= now && dueDate <= cutoffDate;
      });

      upcomingAssignments.push(...upcoming.map((a: Assignment) => ({
        ...a,
        course_name: course.name,
        days_until_due: Math.ceil((new Date(a.due_at!).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
      })));
    }

    upcomingAssignments.sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            upcoming_assignments: upcomingAssignments.map(assignment => ({
              name: assignment.name,
              course: assignment.course_name,
              due_date: assignment.due_at,
              days_until_due: assignment.days_until_due,
              points: assignment.points_possible,
              url: assignment.html_url,
            })),
          }, null, 2),
        },
      ],
    };
  }

  private async getGrades(courseId?: number) {
    let grades: any[] = [];

    if (courseId) {
      const enrollments = await this.makeCanvasRequest(`/courses/${courseId}/enrollments?user_id=self&include[]=grades`);
      const assignments = await this.makeCanvasRequest(`/courses/${courseId}/assignments?include[]=submission&per_page=100`);
      
      grades.push({
        course_id: courseId,
        current_grade: enrollments[0]?.grades?.current_grade,
        current_score: enrollments[0]?.grades?.current_score,
        assignments: assignments.map((a: any) => ({
          name: a.name,
          score: a.submission?.score,
          grade: a.submission?.grade,
          points_possible: a.points_possible,
        })),
      });
    } else {
      const courses = await this.makeCanvasRequest('/courses?enrollment_state=active&include[]=total_scores&per_page=100');
      
      for (const course of courses) {
        const enrollments = await this.makeCanvasRequest(`/courses/${course.id}/enrollments?user_id=self&include[]=grades`);
        grades.push({
          course_name: course.name,
          course_id: course.id,
          current_grade: enrollments[0]?.grades?.current_grade,
          current_score: enrollments[0]?.grades?.current_score,
        });
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ grades }, null, 2),
        },
      ],
    };
  }

  private async getCourseProgress(courseId: number) {
    const [course, enrollments, assignments] = await Promise.all([
      this.makeCanvasRequest(`/courses/${courseId}`),
      this.makeCanvasRequest(`/courses/${courseId}/enrollments?user_id=self&include[]=grades`),
      this.makeCanvasRequest(`/courses/${courseId}/assignments?include[]=submission&per_page=100`),
    ]);

    const completedAssignments = assignments.filter((a: any) => a.submission && a.submission.submitted_at);
    const pendingAssignments = assignments.filter((a: any) => !a.submission || !a.submission.submitted_at);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            course: {
              name: course.name,
              code: course.course_code,
            },
            grade_info: {
              current_grade: enrollments[0]?.grades?.current_grade,
              current_score: enrollments[0]?.grades?.current_score,
            },
            progress: {
              total_assignments: assignments.length,
              completed_assignments: completedAssignments.length,
              pending_assignments: pendingAssignments.length,
              completion_rate: Math.round((completedAssignments.length / assignments.length) * 100),
            },
            pending_assignments: pendingAssignments.map((a: any) => ({
              name: a.name,
              due_date: a.due_at,
              points_possible: a.points_possible,
            })),
          }, null, 2),
        },
      ],
    };
  }

  private async searchAssignments(query: string) {
    const courses = await this.makeCanvasRequest('/courses?enrollment_state=active&per_page=100');
    let allAssignments: any[] = [];

    for (const course of courses) {
      const assignments = await this.makeCanvasRequest(`/courses/${course.id}/assignments?per_page=100`);
      allAssignments.push(...assignments.map((a: Assignment) => ({
        ...a,
        course_name: course.name,
      })));
    }

    const matchingAssignments = allAssignments.filter(assignment =>
      assignment.name.toLowerCase().includes(query.toLowerCase()) ||
      assignment.course_name.toLowerCase().includes(query.toLowerCase())
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query,
            results: matchingAssignments.map(assignment => ({
              name: assignment.name,
              course: assignment.course_name,
              due_date: assignment.due_at,
              points: assignment.points_possible,
              url: assignment.html_url,
            })),
          }, null, 2),
        },
      ],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Canvas MCP server running on stdio');
  }
}

const server = new CanvasMCPServer();
server.run().catch(console.error);