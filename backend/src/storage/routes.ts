import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import { serviceQuery } from "../db.js";
import { verifyToken } from "../jwt.js";
import { parseJsonBody } from "../body.js";

const storageRoot = path.resolve(config.storageDir);

function objectFsPath(bucket: string, objectPath: string): string {
  const safe = path.normalize(objectPath).replace(/^(\.\.[/\\])+/, "");
  return path.join(storageRoot, bucket, safe);
}

async function signObjectToken(bucket: string, objectPath: string, expiresIn: number): Promise<string> {
  const { token } = await import("../jwt.js").then((m) =>
    m.signAccessToken({ sub: `storage:${bucket}:${objectPath}`, role: "service_role" }),
  );
  void expiresIn;
  return token;
}

export function registerStorageRoutes(app: FastifyInstance) {
  app.get("/storage/v1/bucket", async (_req, reply) => {
    const { rows } = await serviceQuery("SELECT * FROM storage.buckets ORDER BY name");
    return reply.send(rows);
  });

  app.get("/storage/v1/bucket/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { rows } = await serviceQuery("SELECT * FROM storage.buckets WHERE id = $1", [id]);
    if (!rows[0]) return reply.status(404).send({ message: "Bucket not found" });
    return reply.send(rows[0]);
  });

  // Upload: POST /storage/v1/object/{bucket}/{*path} (multipart or raw body)
  app.post("/storage/v1/object/:bucket/*", async (req, reply) => {
    const { bucket } = req.params as { bucket: string };
    const objectPath = (req.params as Record<string, string>)["*"];

    const { rows: bucketRows } = await serviceQuery("SELECT id FROM storage.buckets WHERE id = $1", [bucket]);
    if (!bucketRows[0]) return reply.status(404).send({ message: "Bucket not found" });

    const fsPath = objectFsPath(bucket, objectPath);
    await fsp.mkdir(path.dirname(fsPath), { recursive: true });

    let buffer: Buffer;
    let mimeType = (req.headers["content-type"] as string | undefined) ?? "application/octet-stream";

    if (req.isMultipart?.()) {
      const file = await (req as any).file();
      if (!file) return reply.status(400).send({ message: "No file provided" });
      buffer = await file.toBuffer();
      mimeType = file.mimetype ?? mimeType;
    } else {
      buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
    }

    await fsp.writeFile(fsPath, buffer);

    await serviceQuery(
      `INSERT INTO storage.objects (bucket_id, name, metadata)
       VALUES ($1, $2, $3)
       ON CONFLICT (bucket_id, name) DO UPDATE SET metadata = EXCLUDED.metadata, updated_at = now()`,
      [bucket, objectPath, JSON.stringify({ mimetype: mimeType, size: buffer.length })],
    );

    return reply.status(200).send({ Key: `${bucket}/${objectPath}` });
  });

  // Signed URL creation: POST /storage/v1/object/sign/{bucket}/{*path}
  app.post("/storage/v1/object/sign/:bucket/*", async (req, reply) => {
    const { bucket } = req.params as { bucket: string };
    const objectPath = (req.params as Record<string, string>)["*"];
    const body = parseJsonBody<{ expiresIn?: number }>(req) ?? {};
    const expiresIn = body.expiresIn ?? 3600;

    const fsPath = objectFsPath(bucket, objectPath);
    if (!fs.existsSync(fsPath)) return reply.status(404).send({ message: "Object not found" });

    const token = await signObjectToken(bucket, objectPath, expiresIn);
    return reply.status(200).send({ signedURL: `/storage/v1/object/sign/${bucket}/${objectPath}?token=${token}` });
  });

  // Serving a signed URL: GET /storage/v1/object/sign/{bucket}/{*path}?token=...
  app.get("/storage/v1/object/sign/:bucket/*", async (req, reply) => {
    const { bucket } = req.params as { bucket: string };
    const objectPath = (req.params as Record<string, string>)["*"];
    const token = (req.query as Record<string, string>).token;
    if (!token) return reply.status(401).send({ message: "Missing token" });

    try {
      const claims = await verifyToken(token);
      if (claims.sub !== `storage:${bucket}:${objectPath}`) throw new Error("token mismatch");
    } catch {
      return reply.status(401).send({ message: "Invalid or expired token" });
    }

    return sendObject(req, reply, bucket, objectPath);
  });

  // Public serving: GET /storage/v1/object/public/{bucket}/{*path}
  app.get("/storage/v1/object/public/:bucket/*", async (req, reply) => {
    const { bucket } = req.params as { bucket: string };
    const objectPath = (req.params as Record<string, string>)["*"];
    const { rows } = await serviceQuery("SELECT public FROM storage.buckets WHERE id = $1", [bucket]);
    if (!rows[0]?.public) return reply.status(404).send({ message: "not found" });
    return sendObject(req, reply, bucket, objectPath);
  });

  async function sendObject(req: any, reply: any, bucket: string, objectPath: string) {
    const fsPath = objectFsPath(bucket, objectPath);
    if (!fs.existsSync(fsPath)) return reply.status(404).send({ message: "Object not found" });
    const { rows } = await serviceQuery<{ metadata: { mimetype?: string } }>(
      "SELECT metadata FROM storage.objects WHERE bucket_id = $1 AND name = $2",
      [bucket, objectPath],
    );
    const mimeType = rows[0]?.metadata?.mimetype ?? "application/octet-stream";
    const stream = fs.createReadStream(fsPath);
    reply.header("content-type", mimeType);
    return reply.send(stream);
  }
}
