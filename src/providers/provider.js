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
}
