import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    tags: z.array(z.string()).optional().default([]),
    draft: z.boolean().optional().default(false),
  }),
});

const books = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    author: z.string(),
    dateRead: z.coerce.date(),
    rating: z.number().min(1).max(5),
    isbn: z.string().optional(), // For Open Library cover lookup
    cover: z.string().optional(), // Custom cover URL (overrides ISBN)
    tags: z.array(z.string()).optional().default([]),
  }),
});

const projects = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    url: z.string().url().optional(),
    repo: z.string().url().optional(),
    tech: z.array(z.string()).optional().default([]),
    featured: z.boolean().optional().default(false),
  }),
});

const games = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    platform: z.string().optional(),
    datePlayed: z.coerce.date(),
    rating: z.number().min(1).max(5).optional(),
    status: z.enum(['playing', 'completed', 'dropped', 'backlog']).default('completed'),
    cover: z.string().optional(),
    tags: z.array(z.string()).optional().default([]),
  }),
});

export const collections = { blog, books, projects, games };
