// The board's own state (never Hermes'): manual column overrides, test markers, drafts that
// have not been started yet, and copies of media sent from the board. Lives in data/board.json.

import fs from 'node:fs';
import path from 'node:path';

export class Board {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'board.json');
    this.mediaDir = path.join(dir, 'media');
    fs.mkdirSync(this.mediaDir, { recursive: true });
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.data = {};
    }
    this.data.overrides ||= {}; // sessionId -> { column, msgId }
    this.data.test ||= {}; // sessionId -> true
    this.data.drafts ||= {}; // draftId -> { id, title, text, images, audio, test, createdAt }
    this.data.media ||= {}; // sessionId -> [{ afterMsgId, kind, url }]
    this.data.created ||= {}; // sessionId -> createdAt (sessions started from the board)
    this.data.attached ||= {}; // sessionId -> { agentId: { at } }: agents attached by hand (src/agent-links.mjs)
    this.data.detached ||= {}; // sessionId -> { agentId: { at } }: agents taken off a card by hand
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  saveMedia(sessionKey, { data, type, name }) {
    const ext = (type.split('/')[1] || 'bin').split(';')[0].replace('mpeg', 'mp3').replace('x-m4a', 'm4a');
    const base = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const file = `${base}${name ? `-${name.replace(/[^\w.-]/g, '_').replace(/\.[^.]+$/, '')}` : ''}.${ext}`;
    const dir = path.join(this.mediaDir, sessionKey.replace(/[^\w.-]/g, '_'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), Buffer.from(data, 'base64'));
    return `/api/media/${encodeURIComponent(path.basename(dir))}/${encodeURIComponent(file)}`;
  }

  mediaPath(dir, file) {
    const p = path.join(this.mediaDir, dir, file);
    return p.startsWith(this.mediaDir + path.sep) ? p : null;
  }
}
