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

  /**
   * Parses raw LLM text into a JSON object, recovering from markdown wrapping and bad control characters.
   * @param {string} rawText 
   */
  robustParseResponse(rawText) {
    let cleaned = rawText.trim();
    
    // Extract JSON block if it has surrounding markdown/conversational text
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    } else {
      // No JSON braces found, treat as direct text response
      return { text: rawText };
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
        // If it still fails, return the rawText as text instead of throwing
        return { text: rawText };
      }
    }
  }
}
