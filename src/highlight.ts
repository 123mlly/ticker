import { createElement, type ReactNode } from "react";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

export function highlightCode(code: string, lang: string): ReactNode {
  const name = lang.trim().toLowerCase();
  if (!name || !hljs.getLanguage(name)) return code;
  try {
    return renderHljs(hljs.highlight(code, { language: name, ignoreIllegals: true }).value);
  } catch {
    return code;
  }
}

function renderHljs(html: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const stack: { className: string; children: ReactNode[] }[] = [];
  let key = 0;
  const pattern = /<span class="([^"]*)">|<\/span>|([^<]+)/g;
  const push = (node: ReactNode) => {
    const top = stack[stack.length - 1];
    if (top) top.children.push(node);
    else nodes.push(node);
  };
  for (const match of html.matchAll(pattern)) {
    if (match[1] !== undefined && match[0].startsWith("<span")) {
      stack.push({ className: match[1], children: [] });
    } else if (match[0] === "</span>") {
      const top = stack.pop();
      if (!top) continue;
      push(createElement("span", { key: key, className: top.className }, ...top.children));
      key += 1;
    } else if (match[2]) {
      push(decode(match[2]));
    }
  }
  return nodes;
}

function decode(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;/g, "'");
}
