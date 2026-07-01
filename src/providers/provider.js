export class Provider {
  constructor(apiKey, model) {
    this.apiKey = apiKey;
    this.model = model;
  }

  /**
   * Generates a response or tool call from the model.
   * @param {Array} chatHistory - Array of messages {role, content}
   * @param {Array} tools - Available tools array of definitions
   * @returns {Promise<{text: string, toolCalls: Array}>}
   */
  async generateToolCall(chatHistory, tools) {
    throw new Error('generateToolCall must be implemented by subclasses');
  }

  robustParseResponse(rawText) {
    let cleaned = rawText.trim();
    
    // Extract JSON block if it has surrounding markdown/conversational text
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    }

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      try {
        // Find double-quoted string literals and replace raw newlines/tabs inside them
        const escaped = cleaned.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match, p1) => {
          const sanitizedStr = p1
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
          return `"${sanitizedStr}"`;
        });
        return JSON.parse(escaped);
      } catch (e2) {
        // Try to extract "text" or "thought" fields using regex if JSON parsing fails (e.g. due to truncation)
        const textRegex = /"text"\s*:\s*"([^"]*(?:\\.[^"]*)*)"?/;
        const match = cleaned.match(textRegex);
        if (match && match[1]) {
          const parsedText = match[1]
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(/\\"/g, '"');
          return { text: parsedText };
        }
        
        // Match truncated text strings that don't have a closing quote
        const truncatedTextRegex = /"text"\s*:\s*"([\s\S]*)$/;
        const truncMatch = cleaned.match(truncatedTextRegex);
        if (truncMatch && truncMatch[1]) {
          let parsedText = truncMatch[1].trim();
          parsedText = parsedText.replace(/"\s*\}?$/, '');
          parsedText = parsedText
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(/\\"/g, '"');
          return { text: parsedText };
        }

        return { text: rawText };
      }
    }
  }
}
