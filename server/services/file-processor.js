/**
 * File Processor — extract text from uploaded files
 * Supports: .md, .txt, .pdf, .docx
 */
const fs = require('fs');
const path = require('path');

const SUPPORTED_TYPES = new Set([
  '.md', '.txt', '.pdf', '.docx',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain', 'text/markdown'
]);

/**
 * Check if a file type is supported
 */
function isSupported(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ['.md', '.txt', '.pdf', '.docx'].includes(ext);
}

/**
 * Extract text content from a file
 * @param {string} filePath - absolute path to the file
 * @param {string} [originalName] - original filename (for extension detection)
 * @returns {Promise<string>} extracted text
 */
async function extractText(filePath, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();

  if (ext === '.md' || ext === '.txt') {
    return fs.readFileSync(filePath, 'utf-8');
  }

  if (ext === '.pdf') {
    const pdfParse = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text || '';
  }

  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || '';
  }

  throw new Error(`不支持的文件类型：${ext}。请上传 PDF、Word、Markdown 或文本文件。`);
}

module.exports = { extractText, isSupported };
