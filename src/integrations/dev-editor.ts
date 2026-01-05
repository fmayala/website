import type { AstroIntegration } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

// Helper to read JSON body from request
function readJsonBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// Helper to sanitize filename
function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Helper to generate slug from title
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Helper to convert frontmatter object to YAML string
function frontmatterToYaml(data: Record<string, any>): string {
  return Object.entries(data)
    .map(([key, value]) => {
      if (value instanceof Date || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))) {
        return `${key}: ${value}`;
      }
      if (Array.isArray(value)) {
        if (value.length === 0) return null;
        return `${key}:\n${value.map(v => `  - ${v}`).join('\n')}`;
      }
      if (typeof value === 'boolean') {
        return `${key}: ${value}`;
      }
      if (typeof value === 'number') {
        return `${key}: ${value}`;
      }
      if (typeof value === 'string') {
        // Quote strings that contain special YAML characters
        if (value.includes(':') || value.includes('#') || value.includes('"') || value.includes("'")) {
          return `${key}: "${value.replace(/"/g, '\\"')}"`;
        }
        return `${key}: ${value}`;
      }
      return `${key}: ${value}`;
    })
    .filter(Boolean)
    .join('\n');
}

export default function devEditor(): AstroIntegration {
  return {
    name: 'dev-editor',
    hooks: {
      'astro:config:setup': ({ command, updateConfig }) => {
        // Only add the Vite plugin in dev mode
        if (command !== 'dev') return;

        const cwd = process.cwd();
        const contentDir = path.resolve(cwd, 'src/content');
        const dataDir = path.resolve(cwd, 'src/data');
        const galleryDir = path.resolve(cwd, 'public/gallery');
        const galleryConfigPath = path.resolve(dataDir, 'gallery-config.json');
        const memesDir = path.resolve(cwd, 'public/memes');
        const memesConfigPath = path.resolve(dataDir, 'memes-config.json');

        updateConfig({
          vite: {
            plugins: [
              {
                name: 'dev-editor-api',
                configureServer(server) {
                  // Use pre-middleware to intercept before Astro
                  server.middlewares.use((req, res, next) => {
                    const url = req.url?.split('?')[0];

                    // Only handle our dev-editor routes
                    if (!url?.startsWith('/__dev-editor/')) {
                      return next();
                    }

                    // Handle async operations
                    (async () => {

                    // ========== SAVE (existing) ==========
                    if (url === '/__dev-editor/save' && req.method === 'POST') {
                      try {
                        const { filePath, content } = await readJsonBody(req);
                        const absolutePath = path.resolve(cwd, filePath);

                        // Security: Only allow writing to content directory
                        if (!absolutePath.startsWith(contentDir)) {
                          res.statusCode = 403;
                          res.setHeader('Content-Type', 'application/json');
                          res.end(JSON.stringify({ error: 'Can only edit content files' }));
                          return;
                        }

                        await fs.promises.writeFile(absolutePath, content, 'utf-8');
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ success: true }));
                      } catch (err) {
                        res.statusCode = 500;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: String(err) }));
                      }
                      return;
                    }

                    // ========== CREATE (new markdown file) ==========
                    if (url === '/__dev-editor/create' && req.method === 'POST') {
                      try {
                        const { collection, slug, frontmatter, body } = await readJsonBody(req);

                        // Validate collection
                        const allowedCollections = ['books', 'games', 'blog'];
                        if (!allowedCollections.includes(collection)) {
                          res.statusCode = 400;
                          res.setHeader('Content-Type', 'application/json');
                          res.end(JSON.stringify({ error: `Invalid collection: ${collection}` }));
                          return;
                        }

                        // Sanitize slug
                        const safeSlug = slugify(slug);
                        if (!safeSlug) {
                          res.statusCode = 400;
                          res.setHeader('Content-Type', 'application/json');
                          res.end(JSON.stringify({ error: 'Invalid slug' }));
                          return;
                        }

                        const filePath = path.resolve(contentDir, collection, `${safeSlug}.md`);

                        // Check if file already exists
                        if (fs.existsSync(filePath)) {
                          res.statusCode = 409;
                          res.setHeader('Content-Type', 'application/json');
                          res.end(JSON.stringify({ error: 'File already exists' }));
                          return;
                        }

                        // Build markdown content
                        const yamlFrontmatter = frontmatterToYaml(frontmatter);
                        const markdownContent = `---\n${yamlFrontmatter}\n---\n\n${body || ''}`;

                        await fs.promises.writeFile(filePath, markdownContent, 'utf-8');
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ success: true, filePath: `src/content/${collection}/${safeSlug}.md` }));
                      } catch (err) {
                        res.statusCode = 500;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: String(err) }));
                      }
                      return;
                    }

                    // ========== UPLOAD (image to gallery) ==========
                    if (url === '/__dev-editor/upload' && req.method === 'POST') {
                      try {
                        const { filename, data, mimeType } = await readJsonBody(req);

                        // Validate mime type
                        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];
                        if (mimeType && !allowedTypes.includes(mimeType)) {
                          res.statusCode = 400;
                          res.setHeader('Content-Type', 'application/json');
                          res.end(JSON.stringify({ error: 'Invalid image type' }));
                          return;
                        }

                        // Sanitize filename
                        const safeFilename = sanitizeFilename(filename);
                        if (!safeFilename || !safeFilename.match(/\.(jpg|jpeg|png|webp|gif|heic|heif)$/i)) {
                          res.statusCode = 400;
                          res.setHeader('Content-Type', 'application/json');
                          res.end(JSON.stringify({ error: 'Invalid filename' }));
                          return;
                        }

                        // Ensure gallery directory exists
                        await fs.promises.mkdir(galleryDir, { recursive: true });

                        const filePath = path.resolve(galleryDir, safeFilename);

                        // Decode base64 and write file
                        const buffer = Buffer.from(data, 'base64');
                        await fs.promises.writeFile(filePath, new Uint8Array(buffer));

                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ success: true, path: `/gallery/${safeFilename}` }));
                      } catch (err) {
                        res.statusCode = 500;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: String(err) }));
                      }
                      return;
                    }

                    // ========== DELETE (image from gallery) ==========
                    if (url === '/__dev-editor/delete' && req.method === 'DELETE') {
                      try {
                        const { path: imagePath } = await readJsonBody(req);

                        // Security: Only allow deleting from gallery directory
                        if (!imagePath.startsWith('/gallery/')) {
                          res.statusCode = 403;
                          res.setHeader('Content-Type', 'application/json');
                          res.end(JSON.stringify({ error: 'Can only delete gallery images' }));
                          return;
                        }

                        const filename = path.basename(imagePath);
                        const absolutePath = path.resolve(galleryDir, filename);

                        // Extra security check
                        if (!absolutePath.startsWith(galleryDir)) {
                          res.statusCode = 403;
                          res.setHeader('Content-Type', 'application/json');
                          res.end(JSON.stringify({ error: 'Invalid path' }));
                          return;
                        }

                        if (!fs.existsSync(absolutePath)) {
                          res.statusCode = 404;
                          res.setHeader('Content-Type', 'application/json');
                          res.end(JSON.stringify({ error: 'File not found' }));
                          return;
                        }

                        await fs.promises.unlink(absolutePath);
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ success: true }));
                      } catch (err) {
                        res.statusCode = 500;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: String(err) }));
                      }
                      return;
                    }

                    // ========== CONVERT HEIC TO JPEG ==========
                    if (url === '/__dev-editor/convert-heic' && req.method === 'POST') {
                      try {
                        const { data } = await readJsonBody(req);

                        // Decode base64 HEIC data
                        const heicBuffer = Buffer.from(data, 'base64');

                        // Convert to JPEG using Sharp
                        const jpegBuffer = await sharp(heicBuffer)
                          .jpeg({ quality: 92 })
                          .toBuffer();

                        // Return as base64
                        const jpegBase64 = jpegBuffer.toString('base64');

                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ success: true, data: jpegBase64 }));
                      } catch (err) {
                        res.statusCode = 500;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: String(err) }));
                      }
                      return;
                    }

                    // ========== LIST IMAGES ==========
                    if (url === '/__dev-editor/list-images' && req.method === 'GET') {
                      try {
                        // Ensure directory exists
                        await fs.promises.mkdir(galleryDir, { recursive: true });

                        const files = await fs.promises.readdir(galleryDir);
                        const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif'];

                        const images = await Promise.all(
                          files
                            .filter(f => imageExtensions.includes(path.extname(f).toLowerCase()))
                            .map(async (filename) => {
                              const filePath = path.resolve(galleryDir, filename);
                              const stats = await fs.promises.stat(filePath);
                              return {
                                filename,
                                path: `/gallery/${filename}`,
                                size: stats.size,
                                modified: stats.mtime.toISOString(),
                              };
                            })
                        );

                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ images }));
                      } catch (err) {
                        res.statusCode = 500;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: String(err) }));
                      }
                      return;
                    }

                    // ========== GALLERY CONFIG (GET/POST) ==========
                    if (url === '/__dev-editor/gallery') {
                      // Ensure data directory exists
                      await fs.promises.mkdir(dataDir, { recursive: true });

                      if (req.method === 'GET') {
                        try {
                          if (fs.existsSync(galleryConfigPath)) {
                            const content = await fs.promises.readFile(galleryConfigPath, 'utf-8');
                            res.setHeader('Content-Type', 'application/json');
                            res.end(content);
                          } else {
                            res.setHeader('Content-Type', 'application/json');
                            res.end(JSON.stringify({ images: [] }));
                          }
                        } catch (err) {
                          res.statusCode = 500;
                          res.setHeader('Content-Type', 'application/json');
                          res.end(JSON.stringify({ error: String(err) }));
                        }
                        return;
                      }

                      if (req.method === 'POST') {
                        try {
                          const data = await readJsonBody(req);
                          await fs.promises.writeFile(galleryConfigPath, JSON.stringify(data, null, 2), 'utf-8');
                          res.setHeader('Content-Type', 'application/json');
                          res.end(JSON.stringify({ success: true }));
                        } catch (err) {
                          res.statusCode = 500;
                          res.setHeader('Content-Type', 'application/json');
                          res.end(JSON.stringify({ error: String(err) }));
                        }
                        return;
                      }
                    }

                    // ========== MEMES CONFIG (GET/POST) ==========
                    if (url === '/__dev-editor/memes') {
                      await fs.promises.mkdir(dataDir, { recursive: true });

                      if (req.method === 'GET') {
                        try {
                          if (fs.existsSync(memesConfigPath)) {
                            const content = await fs.promises.readFile(memesConfigPath, 'utf-8');
                            res.setHeader('Content-Type', 'application/json');
                            res.end(content);
                          } else {
                            res.setHeader('Content-Type', 'application/json');
                            res.end(JSON.stringify({ images: [] }));
                          }
                        } catch (err) {
                          res.statusCode = 500;
                          res.setHeader('Content-Type', 'application/json');
                          res.end(JSON.stringify({ error: String(err) }));
                        }
                        return;
                      }

                      if (req.method === 'POST') {
                        try {
                          const data = await readJsonBody(req);
                          await fs.promises.writeFile(memesConfigPath, JSON.stringify(data, null, 2), 'utf-8');
                          res.setHeader('Content-Type', 'application/json');
                          res.end(JSON.stringify({ success: true }));
                        } catch (err) {
                          res.statusCode = 500;
                          res.setHeader('Content-Type', 'application/json');
                          res.end(JSON.stringify({ error: String(err) }));
                        }
                        return;
                      }
                    }

                    // ========== UPLOAD MEME ==========
                    if (url === '/__dev-editor/upload-meme' && req.method === 'POST') {
                      try {
                        const { filename, data, mimeType } = await readJsonBody(req);

                        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];
                        if (mimeType && !allowedTypes.includes(mimeType)) {
                          res.statusCode = 400;
                          res.setHeader('Content-Type', 'application/json');
                          res.end(JSON.stringify({ error: 'Invalid image type' }));
                          return;
                        }

                        const safeFilename = sanitizeFilename(filename);
                        if (!safeFilename || !safeFilename.match(/\.(jpg|jpeg|png|webp|gif|heic|heif)$/i)) {
                          res.statusCode = 400;
                          res.setHeader('Content-Type', 'application/json');
                          res.end(JSON.stringify({ error: 'Invalid filename' }));
                          return;
                        }

                        await fs.promises.mkdir(memesDir, { recursive: true });

                        const filePath = path.resolve(memesDir, safeFilename);

                        const buffer = Buffer.from(data, 'base64');
                        await fs.promises.writeFile(filePath, new Uint8Array(buffer));

                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ success: true, path: `/memes/${safeFilename}` }));
                      } catch (err) {
                        res.statusCode = 500;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: String(err) }));
                      }
                      return;
                    }

                    // ========== DELETE MEME ==========
                    if (url === '/__dev-editor/delete-meme' && req.method === 'DELETE') {
                      try {
                        const { path: imagePath } = await readJsonBody(req);

                        if (!imagePath.startsWith('/memes/')) {
                          res.statusCode = 403;
                          res.setHeader('Content-Type', 'application/json');
                          res.end(JSON.stringify({ error: 'Can only delete meme images' }));
                          return;
                        }

                        const filename = path.basename(imagePath);
                        const absolutePath = path.resolve(memesDir, filename);

                        if (!absolutePath.startsWith(memesDir)) {
                          res.statusCode = 403;
                          res.setHeader('Content-Type', 'application/json');
                          res.end(JSON.stringify({ error: 'Invalid path' }));
                          return;
                        }

                        if (!fs.existsSync(absolutePath)) {
                          res.statusCode = 404;
                          res.setHeader('Content-Type', 'application/json');
                          res.end(JSON.stringify({ error: 'File not found' }));
                          return;
                        }

                        await fs.promises.unlink(absolutePath);
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ success: true }));
                      } catch (err) {
                        res.statusCode = 500;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: String(err) }));
                      }
                      return;
                    }

                    // ========== LIST MEMES ==========
                    if (url === '/__dev-editor/list-memes' && req.method === 'GET') {
                      try {
                        await fs.promises.mkdir(memesDir, { recursive: true });

                        const files = await fs.promises.readdir(memesDir);
                        const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif'];

                        const images = await Promise.all(
                          files
                            .filter(f => imageExtensions.includes(path.extname(f).toLowerCase()))
                            .map(async (filename) => {
                              const filePath = path.resolve(memesDir, filename);
                              const stats = await fs.promises.stat(filePath);
                              return {
                                filename,
                                path: `/memes/${filename}`,
                                size: stats.size,
                                modified: stats.mtime.toISOString(),
                              };
                            })
                        );

                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ images }));
                      } catch (err) {
                        res.statusCode = 500;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: String(err) }));
                      }
                      return;
                    }

                    // Unknown dev-editor endpoint
                    res.statusCode = 404;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Unknown endpoint' }));
                    })().catch((err) => {
                      res.statusCode = 500;
                      res.setHeader('Content-Type', 'application/json');
                      res.end(JSON.stringify({ error: String(err) }));
                    });
                  });
                },
              },
            ],
          },
        });
      },
    },
  };
}
