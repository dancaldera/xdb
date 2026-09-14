export type SqlScriptEvent =
  | { kind: "statement"; sql: string }
  | { kind: "copy-start"; sql: string }
  | { kind: "copy-chunk"; chunk: string }
  | { kind: "copy-end" };

type ParserMode =
  | "plain"
  | "single-quote"
  | "double-quote"
  | "line-comment"
  | "block-comment"
  | "dollar-quote"
  | "meta-command"
  | "copy-data";

export function isCopyFromStdin(sql: string): boolean {
  return /^copy[\s(]/i.test(sql.trimStart()) && /\bfrom\s+stdin\b/i.test(sql);
}

export async function* parseSqlScript(input: AsyncIterable<string>): AsyncGenerator<SqlScriptEvent> {
  const parser = new SqlScriptParser();

  for await (const chunk of input) {
    yield* parser.push(chunk);
  }

  yield* parser.finish();
}

export class SqlScriptParser {
  private buffer = "";
  private index = 0;
  private mode: ParserMode = "plain";
  private hasContent = false;
  private escapeStringQuote = false;
  private blockCommentDepth = 0;
  private dollarTag = "";
  private skipCopyNewline = false;

  push(chunk: string): SqlScriptEvent[] {
    this.buffer += chunk;
    return this.scan(false);
  }

  finish(): SqlScriptEvent[] {
    return this.scan(true);
  }

  private scan(eof: boolean): SqlScriptEvent[] {
    const events: SqlScriptEvent[] = [];

    scanning: while (true) {
      if (this.mode === "copy-data") {
        if (this.scanCopyData(events, eof)) {
          continue;
        }
        break;
      }

      if (this.index >= this.buffer.length) {
        break;
      }

      const char = this.buffer[this.index];

      switch (this.mode) {
        case "single-quote": {
          if (this.escapeStringQuote && char === "\\") {
            if (this.index + 1 >= this.buffer.length && !eof) {
              break scanning;
            }
            this.index += 2;
            continue;
          }
          if (char === "'") {
            if (this.index + 1 >= this.buffer.length && !eof) {
              break scanning;
            }
            if (this.buffer[this.index + 1] === "'") {
              this.index += 2;
              continue;
            }
            this.mode = "plain";
          }
          this.index += 1;
          continue;
        }
        case "double-quote": {
          if (char === '"') {
            if (this.index + 1 >= this.buffer.length && !eof) {
              break scanning;
            }
            if (this.buffer[this.index + 1] === '"') {
              this.index += 2;
              continue;
            }
            this.mode = "plain";
          }
          this.index += 1;
          continue;
        }
        case "line-comment": {
          if (char === "\n") {
            this.mode = "plain";
          }
          this.index += 1;
          continue;
        }
        case "block-comment": {
          if (char === "*" || char === "/") {
            if (this.index + 1 >= this.buffer.length && !eof) {
              break scanning;
            }
            const next = this.buffer[this.index + 1];
            if (char === "*" && next === "/") {
              this.blockCommentDepth -= 1;
              this.index += 2;
              if (this.blockCommentDepth === 0) {
                this.mode = "plain";
              }
              continue;
            }
            if (char === "/" && next === "*") {
              this.blockCommentDepth += 1;
              this.index += 2;
              continue;
            }
          }
          this.index += 1;
          continue;
        }
        case "dollar-quote": {
          if (char === "$") {
            if (this.index + this.dollarTag.length > this.buffer.length && !eof) {
              break scanning;
            }
            if (this.buffer.startsWith(this.dollarTag, this.index)) {
              this.index += this.dollarTag.length;
              this.mode = "plain";
              continue;
            }
          }
          this.index += 1;
          continue;
        }
        case "meta-command": {
          const newline = this.buffer.indexOf("\n", this.index);
          if (newline === -1) {
            if (!eof) {
              // The whole pending line is discarded either way; free the buffer.
              this.buffer = "";
              this.index = 0;
              break scanning;
            }
            this.resetStatement(this.buffer.length);
            break scanning;
          }
          this.resetStatement(newline + 1);
          continue;
        }
        case "plain": {
          if (char === ";") {
            const sql = this.buffer.slice(0, this.index + 1).trim();
            const consumed = this.index + 1;
            if (this.hasContent && isCopyFromStdin(sql)) {
              events.push({ kind: "copy-start", sql });
              this.buffer = this.buffer.slice(consumed);
              this.index = 0;
              this.hasContent = false;
              this.mode = "copy-data";
              this.skipCopyNewline = true;
              continue;
            }
            if (this.hasContent) {
              events.push({ kind: "statement", sql });
            }
            this.resetStatement(consumed);
            continue;
          }
          if (char === "'") {
            const previous = this.index > 0 ? this.buffer[this.index - 1] : "";
            const beforePrevious = this.index > 1 ? this.buffer[this.index - 2] : "";
            this.escapeStringQuote = (previous === "e" || previous === "E") && !/[A-Za-z0-9_$]/.test(beforePrevious);
            this.mode = "single-quote";
            this.hasContent = true;
            this.index += 1;
            continue;
          }
          if (char === '"') {
            this.mode = "double-quote";
            this.hasContent = true;
            this.index += 1;
            continue;
          }
          if (char === "-" || char === "/") {
            if (this.index + 1 >= this.buffer.length && !eof) {
              break scanning;
            }
            const next = this.buffer[this.index + 1];
            if (char === "-" && next === "-") {
              this.mode = "line-comment";
              this.index += 2;
              continue;
            }
            if (char === "/" && next === "*") {
              this.mode = "block-comment";
              this.blockCommentDepth = 1;
              this.index += 2;
              continue;
            }
            this.hasContent = true;
            this.index += 1;
            continue;
          }
          if (char === "$") {
            const tagEnd = this.findDollarTagEnd(eof);
            if (tagEnd === "wait") {
              break scanning;
            }
            this.hasContent = true;
            if (tagEnd === null) {
              this.index += 1;
              continue;
            }
            this.dollarTag = this.buffer.slice(this.index, tagEnd + 1);
            this.mode = "dollar-quote";
            this.index = tagEnd + 1;
            continue;
          }
          if (char === "\\" && !this.hasContent && (this.index === 0 || this.buffer[this.index - 1] === "\n")) {
            this.mode = "meta-command";
            continue;
          }
          if (!/\s/.test(char)) {
            this.hasContent = true;
          }
          this.index += 1;
          continue;
        }
      }
    }

    if (eof && this.mode !== "copy-data") {
      const sql = this.buffer.trim();
      if (this.hasContent && sql) {
        if (isCopyFromStdin(sql)) {
          events.push({ kind: "copy-start", sql }, { kind: "copy-end" });
        } else {
          events.push({ kind: "statement", sql });
        }
      }
      this.resetStatement(this.buffer.length);
    }

    return events;
  }

  /**
   * At a `$` in plain mode, returns the index of the closing `$` of a valid
   * dollar-quote opener (e.g. `$tag$`), null if this is not an opener, or
   * "wait" when more input is needed to decide.
   */
  private findDollarTagEnd(eof: boolean): number | null | "wait" {
    let cursor = this.index + 1;

    while (true) {
      if (cursor >= this.buffer.length) {
        return eof ? null : "wait";
      }
      const char = this.buffer[cursor];
      if (char === "$") {
        const tag = this.buffer.slice(this.index + 1, cursor);
        return tag === "" || /^[A-Za-z_][A-Za-z0-9_]*$/.test(tag) ? cursor : null;
      }
      if (!/[A-Za-z0-9_]/.test(char)) {
        return null;
      }
      cursor += 1;
    }
  }

  private scanCopyData(events: SqlScriptEvent[], eof: boolean): boolean {
    if (this.skipCopyNewline) {
      if (!this.buffer.length && !eof) {
        return false;
      }
      if (this.buffer.startsWith("\r\n")) {
        this.buffer = this.buffer.slice(2);
      } else if (this.buffer.startsWith("\n")) {
        this.buffer = this.buffer.slice(1);
      }
      this.skipCopyNewline = false;
    }

    let lineStart = 0;

    while (true) {
      const newline = this.buffer.indexOf("\n", lineStart);
      if (newline === -1) {
        break;
      }
      if (isCopyTerminatorLine(this.buffer.slice(lineStart, newline))) {
        if (lineStart > 0) {
          events.push({ kind: "copy-chunk", chunk: this.buffer.slice(0, lineStart) });
        }
        events.push({ kind: "copy-end" });
        this.buffer = this.buffer.slice(newline + 1);
        this.index = 0;
        this.hasContent = false;
        this.mode = "plain";
        return true;
      }
      lineStart = newline + 1;
    }

    if (eof) {
      const rest = this.buffer;
      this.buffer = "";
      this.index = 0;
      this.mode = "plain";
      this.hasContent = false;
      if (rest && !isCopyTerminatorLine(rest)) {
        events.push({ kind: "copy-chunk", chunk: rest });
      }
      events.push({ kind: "copy-end" });
      return false;
    }

    if (lineStart > 0) {
      events.push({ kind: "copy-chunk", chunk: this.buffer.slice(0, lineStart) });
      this.buffer = this.buffer.slice(lineStart);
    }
    return false;
  }

  private resetStatement(consumed: number): void {
    this.buffer = this.buffer.slice(consumed);
    this.index = 0;
    this.hasContent = false;
    this.mode = "plain";
  }
}

function isCopyTerminatorLine(line: string): boolean {
  return line === "\\." || line === "\\.\r";
}
