const fs = require("fs");
const path = require("path");

const p = path.join(__dirname, "../renderer/ui/DiscoveryView.js");
let content = fs.readFileSync(p, "utf8");

// Replace the action-cancel-btn with a rounded, stylish circular button
const regex = /<button class="action-cancel-btn"[\s\S]*?<\/button>/;

const roundedBtn = `<button class="action-cancel-btn" data-id="\${trackId}" style="width: 20px; height: 20px; border-radius: 50%; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); display: flex; align-items: center; justify-content: center; padding: 0; cursor: pointer; color: rgba(255,255,255,0.6); font-size: 11px; line-height: 1; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);" title="Cancel download" onmouseover="this.style.background='rgba(239,68,68,0.2)'; this.style.borderColor='rgba(239,68,68,0.5)'; this.style.color='#ef4444';" onmouseout="this.style.background='rgba(255,255,255,0.08)'; this.style.borderColor='rgba(255,255,255,0.15)'; this.style.color='rgba(255,255,255,0.6)';">✕</button>`;

if (!regex.test(content)) {
  console.error("action-cancel-btn regex not found!");
  process.exit(1);
}

content = content.replace(regex, roundedBtn);
fs.writeFileSync(p, content, "utf8");
console.log("Successfully styled cancel button with rounded circular design!");
