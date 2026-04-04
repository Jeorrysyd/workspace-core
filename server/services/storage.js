/**
 * Storage Service — File-based project storage
 * Abstracted for future database backends
 */
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const PROJECTS_DIR = path.join(__dirname, '..', '..', 'data', 'projects');
if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true });

const DRAFTS_DIR = path.join(__dirname, '..', '..', 'data', 'drafts');
if (!fs.existsSync(DRAFTS_DIR)) fs.mkdirSync(DRAFTS_DIR, { recursive: true });

// ── Projects ────────────────────────────────────────────────────────────────

function projectPath(id) {
  return path.join(PROJECTS_DIR, `${id}.json`);
}

function validateProjectId(id) {
  return /^proj-[a-f0-9-]{36}$/.test(id);
}

const storage = {
  async listProjects() {
    const files = (await fsPromises.readdir(PROJECTS_DIR)).filter(f => f.endsWith('.json'));
    const projects = await Promise.all(files.map(async f => {
      try {
        const data = JSON.parse(await fsPromises.readFile(path.join(PROJECTS_DIR, f), 'utf-8'));
        return {
          id: data.id,
          title: data.title || '未命名项目',
          currentStep: data.currentStep || 1,
          format: data.create?.format || null,
          updatedAt: data.updatedAt,
          createdAt: data.createdAt
        };
      } catch { return null; }
    }));
    return projects.filter(Boolean).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  },

  async getProject(id) {
    if (!validateProjectId(id)) return null;
    try {
      return JSON.parse(await fsPromises.readFile(projectPath(id), 'utf-8'));
    } catch { return null; }
  },

  async createProject(data = {}) {
    const id = `proj-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const project = {
      id,
      title: data.title || '未命名项目',
      currentStep: data.currentStep || 1,
      createdAt: now,
      updatedAt: now,
      discover: null,
      select: null,
      angle: null,
      create: null,
      polish: null,
      ...data
    };
    await fsPromises.writeFile(projectPath(id), JSON.stringify(project, null, 2));
    return project;
  },

  async updateProject(id, updates) {
    if (!validateProjectId(id)) throw new Error('无效的项目 ID');
    const project = await this.getProject(id);
    if (!project) throw new Error('项目不存在');
    Object.assign(project, updates, { updatedAt: new Date().toISOString() });
    await fsPromises.writeFile(projectPath(id), JSON.stringify(project, null, 2));
    return project;
  },

  async deleteProject(id) {
    if (!validateProjectId(id)) throw new Error('无效的项目 ID');
    try { await fsPromises.unlink(projectPath(id)); } catch {}
  },

  // ── Drafts (legacy, kept for backward compat) ──────────────────────────

  async listDrafts() {
    const files = (await fsPromises.readdir(DRAFTS_DIR)).filter(f => f.endsWith('.json'));
    const drafts = await Promise.all(files.map(async f => {
      try {
        const data = JSON.parse(await fsPromises.readFile(path.join(DRAFTS_DIR, f), 'utf-8'));
        return {
          id: data.id,
          title: data.title,
          type: data.type,
          platform: data.platform,
          wordCount: (data.content || '').replace(/\s/g, '').length,
          updatedAt: data.updatedAt
        };
      } catch { return null; }
    }));
    return drafts.filter(Boolean).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  },

  async createDraft(data) {
    const id = `draft-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const draft = { id, ...data, createdAt: now, updatedAt: now };
    await fsPromises.writeFile(path.join(DRAFTS_DIR, `${id}.json`), JSON.stringify(draft, null, 2));
    return draft;
  },

  async updateDraft(id, updates) {
    if (!/^draft-[a-f0-9-]{36}$/.test(id)) throw new Error('无效的草稿 ID');
    const filePath = path.join(DRAFTS_DIR, `${id}.json`);
    let draft = {};
    try { draft = JSON.parse(await fsPromises.readFile(filePath, 'utf-8')); } catch {}
    Object.assign(draft, { id, ...updates, updatedAt: new Date().toISOString() });
    await fsPromises.writeFile(filePath, JSON.stringify(draft, null, 2));
    return draft;
  },

  async deleteDraft(id) {
    if (!/^draft-[a-f0-9-]{36}$/.test(id)) throw new Error('无效的草稿 ID');
    try { await fsPromises.unlink(path.join(DRAFTS_DIR, `${id}.json`)); } catch {}
  }
};

module.exports = storage;
