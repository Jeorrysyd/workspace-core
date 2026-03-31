const input = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
const filePath = input.tool_input?.file_path || '';

// 只检查 claude.js 这个文件
if (!filePath.includes('server/services/claude.js')) {
  process.exit(0); // 不是目标文件，放行
}

const newContent = input.tool_input?.new_content || input.tool_input?.new_string || '';

// 检查关键调用方式有没有被改坏
if (newContent && !newContent.includes('claude -p')) {
  console.error('⛔ Hook 拦截：claude.js 里没有找到 claude -p 调用方式，可能被意外修改了，请确认后再继续。');
  process.exit(1); // 返回1 = 阻止Claude继续操作
}

process.exit(0); // 通过检查
