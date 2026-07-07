import { execGws } from '../config.js';

async function resolveContactResourceName(contactNameOrResourceName) {
  if (contactNameOrResourceName.startsWith('people/')) {
    return contactNameOrResourceName;
  }
  const lookupArgs = [
    'people',
    'people',
    'searchContacts',
    '--params',
    JSON.stringify({
      query: contactNameOrResourceName,
      readMask: 'names'
    }),
    '--format',
    'json'
  ];
  try {
    const stdout = (await execGws(lookupArgs)).toString();
    const data = JSON.parse(stdout);
    const results = data.results || [];
    if (results.length > 0) {
      return results[0].person.resourceName;
    }
  } catch (e) {
    // ignore
  }
  throw new Error(`Could not find contact with name: "${contactNameOrResourceName}"`);
}

async function getContact(resourceName) {
  const args = [
    'people',
    'people',
    'get',
    '--params',
    JSON.stringify({
      resourceName,
      personFields: 'names,emailAddresses,phoneNumbers,metadata'
    }),
    '--format',
    'json'
  ];
  const stdout = (await execGws(args)).toString();
  return JSON.parse(stdout);
}

export const contactsList = {
  name: 'contacts_list',
  description: "List the authenticated user's Google Contacts (connections)",
  schema: {
    type: 'object',
    properties: {
      pageSize: { type: 'integer', description: 'Optional. Number of contacts to list (default: 50, max: 100)' }
    }
  },
  risk: 'safe',
  async execute({ pageSize = 50 } = {}) {
    try {
      const args = [
        'people',
        'people',
        'connections',
        'list',
        '--params',
        JSON.stringify({
          resourceName: 'people/me',
          personFields: 'names,emailAddresses,phoneNumbers',
          pageSize
        }),
        '--format',
        'json'
      ];
      const stdout = (await execGws(args)).toString();
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

export const contactsSearch = {
  name: 'contacts_search',
  description: "Search the user's Google Contacts matching a name, email, or query term",
  schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query or name prefix' }
    },
    required: ['query']
  },
  risk: 'safe',
  async execute({ query }) {
    try {
      const args = [
        'people',
        'people',
        'searchContacts',
        '--params',
        JSON.stringify({
          query,
          readMask: 'names,emailAddresses,phoneNumbers'
        }),
        '--format',
        'json'
      ];
      const stdout = (await execGws(args)).toString();
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

export const contactsCreate = {
  name: 'contacts_create',
  description: 'Create a new Google Contact',
  schema: {
    type: 'object',
    properties: {
      firstName: { type: 'string', description: 'First or given name' },
      lastName: { type: 'string', description: 'Last or family name' },
      email: { type: 'string', description: 'Email address of the contact' },
      phone: { type: 'string', description: 'Phone number of the contact' }
    },
    required: ['firstName', 'lastName']
  },
  risk: 'confirm',
  async execute({ firstName, lastName, email, phone }) {
    try {
      const body = {
        names: [{ givenName: firstName, familyName: lastName }]
      };
      if (email) {
        body.emailAddresses = [{ value: email }];
      }
      if (phone) {
        body.phoneNumbers = [{ value: phone }];
      }
      const args = [
        'people',
        'people',
        'createContact',
        '--json',
        JSON.stringify(body),
        '--format',
        'json'
      ];
      const stdout = (await execGws(args)).toString();
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

export const contactsUpdate = {
  name: 'contacts_update',
  description: "Update details of an existing Google Contact by name or resource ID",
  schema: {
    type: 'object',
    properties: {
      contact: { type: 'string', description: 'The contact name or resource ID (e.g. people/c12345) to update' },
      firstName: { type: 'string', description: 'New first/given name' },
      lastName: { type: 'string', description: 'New last/family name' },
      email: { type: 'string', description: 'New email address' },
      phone: { type: 'string', description: 'New phone number' }
    },
    required: ['contact']
  },
  risk: 'confirm',
  async execute({ contact, firstName, lastName, email, phone }) {
    try {
      const resourceName = await resolveContactResourceName(contact);
      const current = await getContact(resourceName);
      
      const body = {
        etag: current.etag
      };
      const updateFields = [];

      if (firstName || lastName) {
        const currentName = current.names?.[0] || {};
        body.names = [{
          givenName: firstName !== undefined ? firstName : currentName.givenName,
          familyName: lastName !== undefined ? lastName : currentName.familyName
        }];
        updateFields.push('names');
      }
      if (email !== undefined) {
        body.emailAddresses = email ? [{ value: email }] : [];
        updateFields.push('emailAddresses');
      }
      if (phone !== undefined) {
        body.phoneNumbers = phone ? [{ value: phone }] : [];
        updateFields.push('phoneNumbers');
      }

      if (updateFields.length === 0) {
        throw new Error('No update fields provided');
      }

      const params = {
        resourceName,
        updatePersonFields: updateFields.join(',')
      };

      const args = [
        'people',
        'people',
        'updateContact',
        '--params',
        JSON.stringify(params),
        '--json',
        JSON.stringify(body),
        '--format',
        'json'
      ];
      const stdout = (await execGws(args)).toString();
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

export const contactsDelete = {
  name: 'contacts_delete',
  description: "Delete a Google Contact by name or resource ID",
  schema: {
    type: 'object',
    properties: {
      contact: { type: 'string', description: 'The contact name or resource ID (e.g. people/c12345) to delete' }
    },
    required: ['contact']
  },
  risk: 'high',
  async execute({ contact }) {
    try {
      const resourceName = await resolveContactResourceName(contact);
      const args = [
        'people',
        'people',
        'deleteContact',
        '--params',
        JSON.stringify({ resourceName }),
        '--format',
        'json'
      ];
      await execGws(args);
      return { success: true, output: `Successfully deleted contact "${contact}".` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};
