// Agent trial: run real tasks through a headless Claude session that only has the photoshop MCP tools,
// then report tool usage, errors and outputs. Usage:
//   node test/agent-trial.mjs <workdir-with-shikara.jpg-and-horses.jpg> [model] [taskId...]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const [dir, model = 'sonnet', ...only] = process.argv.slice(2);
if (!dir) { console.error('usage: node test/agent-trial.mjs <workdir> [model] [taskId...]'); process.exit(2); }
const OUT = join(dir, 'out');
mkdirSync(OUT, { recursive: true });

const cfg = join(OUT, 'mcp.json');
writeFileSync(cfg, JSON.stringify({ mcpServers: { photoshop: { command: 'node', args: [join(ROOT, 'server.mjs')] } } }));

const TASKS = [
  {
    id: 'grade',
    prompt: `Open ${dir}/shikara.jpg in Photoshop. Color grade it into a warm, cinematic golden-hour look using non-destructive layers grouped as "Grade". Check your work visually as you go. Export the result as ${OUT}/shikara-graded.jpg and a layered ${OUT}/shikara-graded.psd. Do not modify or close any other open document. When finished, close the shikara document (it is a scratch copy, discarding is fine) and summarize the grade with exact values.`,
    outputs: ['shikara-graded.jpg', 'shikara-graded.psd'],
  },
  {
    id: 'poster',
    prompt: `In Photoshop, create a 1080x1350 Instagram poster. Use ${dir}/horses.jpg as the hero image filling the top 60% of the canvas. Add the title "Horses in a Dream", the subtitle "Dreamlight Photo Collection" and a small footer "dreamlight.studio" on a dark background below the image. Make it look professionally designed: clear typography hierarchy, centered text, generous margins. Verify by rendering. Export to ${OUT}/poster.png, then close the poster document without saving and summarize what you built.`,
    outputs: ['poster.png'],
  },
  {
    id: 'revise',
    prompt: `Open ${OUT}/shikara-graded.psd in Photoshop. Explain briefly what each layer in it does, then make the whole grade about 30% subtler while keeping its character, and warm up only the boat a little more than the rest (it should stay natural). Verify visually. Export to ${OUT}/shikara-revised.jpg, save the layered version as ${OUT}/shikara-revised.psd, close the document without saving changes to shikara-graded.psd, and summarize the exact changes.`,
    outputs: ['shikara-revised.jpg', 'shikara-revised.psd'],
  },
];

function runTask(task) {
  return new Promise((resolve) => {
    const started = Date.now();
    const args = ['-p', task.prompt, '--mcp-config', cfg, '--strict-mcp-config', '--allowedTools', 'mcp__photoshop__*',
      '--output-format', 'stream-json', '--verbose', '--model', model];
    const child = spawn('claude', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    const lines = [], calls = [], errors = [];
    let final = null, cost = null;
    const pending = new Map();
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        lines.push(line);
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        const blocks = ev.message?.content;
        if (ev.type === 'assistant' && Array.isArray(blocks)) {
          for (const b of blocks) if (b.type === 'tool_use') { pending.set(b.id, b); calls.push({ tool: b.name.replace('mcp__photoshop__', ''), input: b.input }); }
        }
        if (ev.type === 'user' && Array.isArray(blocks)) {
          for (const b of blocks) if (b.type === 'tool_result' && b.is_error) {
            const use = pending.get(b.tool_use_id);
            const text = Array.isArray(b.content) ? b.content.map((c) => c.text || '').join(' ') : String(b.content);
            errors.push({ tool: use?.name.replace('mcp__photoshop__', ''), input: use?.input, error: text.slice(0, 400) });
          }
        }
        if (ev.type === 'result') { final = ev.result; cost = ev.total_cost_usd; }
      }
    });
    child.stderr.on('data', () => {});
    child.on('close', (code) => {
      writeFileSync(join(OUT, `${task.id}.transcript.jsonl`), lines.join('\n'));
      const byTool = {};
      for (const c of calls) byTool[c.tool] = (byTool[c.tool] || 0) + 1;
      const outputs = Object.fromEntries(task.outputs.map((f) => [f, existsSync(join(OUT, f)) ? statSync(join(OUT, f)).size : null]));
      resolve({ id: task.id, exit: code, minutes: +((Date.now() - started) / 60000).toFixed(1), costUsd: cost, toolCalls: calls.length, byTool, errors, outputs, final });
    });
  });
}

const results = [];
for (const t of TASKS.filter((t) => !only.length || only.includes(t.id))) {
  console.log(`▶ ${t.id} (${model})…`);
  const r = await runTask(t);
  results.push(r);
  console.log(JSON.stringify({ ...r, final: r.final?.slice(0, 1500) }, null, 2));
}
writeFileSync(join(OUT, 'trial-results.json'), JSON.stringify(results, null, 2));
