const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'static', 'learning', 'growth-upload.js');
const script = fs.readFileSync(scriptPath, 'utf8');

test('posts to the current growth record URL when a submit control is named action', () => {
  const currentUrl = 'https://classroom.example.test/student/courses/5/growth/R01/';
  let submitHandler;
  let request;
  const button = { type: 'submit', name: 'action', value: 'save_draft', disabled: false };
  const progress = { hidden: true, value: 0 };
  const status = { textContent: '' };
  const form = {
    action: { toString: () => '[object RadioNodeList]' },
    addEventListener: (_type, handler) => { submitHandler = handler; },
    getAttribute: () => null,
    querySelector: (selector) => selector.includes('progress') ? progress : status,
    querySelectorAll: () => [button],
  };

  class MockFormData {
    append() {}
  }

  class MockXMLHttpRequest {
    constructor() {
      this.upload = { addEventListener() {} };
    }
    open(_method, url) {
      request = new URL(String(url), currentUrl);
    }
    addEventListener() {}
    send() {}
  }

  const context = {
    document: { querySelectorAll: () => [form] },
    window: {
      location: { href: currentUrl },
      FormData: MockFormData,
      XMLHttpRequest: MockXMLHttpRequest,
      confirm: () => true,
    },
    FormData: MockFormData,
    XMLHttpRequest: MockXMLHttpRequest,
  };
  vm.runInNewContext(script, context);
  submitHandler({ preventDefault() {}, submitter: button });

  assert.equal(request.href, currentUrl);
});
