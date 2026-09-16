const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'static', 'learning', 'growth-upload.js');
const script = fs.readFileSync(scriptPath, 'utf8');

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.attributes = {};
    this.textContent = '';
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  append(...children) {
    children.forEach((child) => {
      child.parent = this;
      this.children.push(child);
    });
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
  }

  querySelectorAll(selector) {
    if (selector === '[data-pending-photo]') {
      return this.children.filter((child) => Object.hasOwn(child.dataset, 'pendingPhoto'));
    }
    return [];
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  click(event = { preventDefault() {} }) {
    this.clickCount = (this.clickCount || 0) + 1;
    this.listeners.click?.(event);
  }
}

function createPage(existingImageCount = 0) {
  const currentUrl = 'https://classroom.example.test/student/courses/5/growth/R01/';
  const input = new FakeElement('input');
  input.files = [];
  input.value = '';
  const videoInput = new FakeElement('input');
  videoInput.files = [];
  videoInput.value = '';
  const documentInput = new FakeElement('input');
  documentInput.files = [];
  documentInput.value = '';
  const picker = new FakeElement('label');
  const videoPicker = new FakeElement('label');
  const documentList = new FakeElement();
  const documentStatus = { textContent: '' };
  const list = new FakeElement();
  const videoPreview = new FakeElement();
  const count = { textContent: '' };
  const progress = { hidden: true, value: 0 };
  const status = { textContent: '' };
  const videoStatus = { textContent: '' };
  const saveButton = Object.assign(new FakeElement('button'), {
    type: 'submit', name: 'action', value: 'save_draft', disabled: false,
  });
  const submitButton = Object.assign(new FakeElement('button'), {
    type: 'submit', name: 'action', value: 'submit_review', disabled: false,
  });
  const form = new FakeElement('form');
  form.dataset.existingImageCount = String(existingImageCount);
  form.getAttribute = () => null;
  form.querySelector = (selector) => ({
    '[data-growth-images]': input,
    '[data-growth-photo-picker]': picker,
    '[data-growth-video]': videoInput,
    '[data-growth-video-picker]': videoPicker,
    '[data-growth-video-preview]': videoPreview,
    '[data-growth-video-status]': videoStatus,
    '[data-growth-documents]': documentInput,
    '[data-growth-document-list]': documentList,
    '[data-growth-document-status]': documentStatus,
    '[data-growth-photo-list]': list,
    '[data-growth-photo-count]': count,
    '[data-upload-progress]': progress,
    '[data-upload-status]': status,
  })[selector] || null;
  form.querySelectorAll = (selector) => selector === 'button[type=submit]'
    ? [saveButton, submitButton]
    : [];

  let request;
  class MockFormData {
    constructor() {
      this.items = [];
    }
    set(name, value) {
      this.items = this.items.filter((item) => item[0] !== name);
      this.items.push([name, value]);
    }
    append(name, value, filename) {
      this.items.push([name, value, filename]);
    }
  }

  class MockXMLHttpRequest {
    constructor() {
      this.upload = { addEventListener() {} };
      this.headers = {};
    }
    open(_method, url) {
      request = this;
      this.url = new URL(String(url), currentUrl);
    }
    setRequestHeader(name, value) {
      this.headers[name] = value;
    }
    getResponseHeader(name) {
      return this.responseHeaders?.[name] || '';
    }
    addEventListener(type, handler) {
      this.listeners ||= {};
      this.listeners[type] = handler;
    }
    send(data) {
      this.data = data;
    }
  }

  let reloadCount = 0;
  const sandbox = {
    document: {
      querySelectorAll: () => [form],
      createElement: (tagName) => new FakeElement(tagName),
    },
    window: {
      location: { href: currentUrl, reload() { reloadCount += 1; } },
      FormData: MockFormData,
      XMLHttpRequest: MockXMLHttpRequest,
      confirm: () => true,
    },
    URL: {
      createObjectURL: (file) => `blob:${file.name}`,
      revokeObjectURL() {},
    },
    DOMParser: class {},
    FormData: MockFormData,
    XMLHttpRequest: MockXMLHttpRequest,
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(script, context);

  return {
    context,
    form,
    input,
    videoInput,
    documentInput,
    documentList,
    documentStatus,
    picker,
    videoPicker,
    videoPreview,
    videoStatus,
    list,
    count,
    status,
    saveButton,
    submitButton,
    submit: form.listeners.submit,
    get request() { return request; },
    get reloadCount() { return reloadCount; },
  };
}

test('posts to the current growth record URL when a submit control is named action', () => {
  const page = createPage();
  page.submit({ preventDefault() {}, submitter: page.saveButton });
  assert.equal(page.request.url.href, 'https://classroom.example.test/student/courses/5/growth/R01/');
});

test('keeps submit_review action when Safari submit event has no submitter', () => {
  const page = createPage();
  page.submitButton.click();
  page.submit({ preventDefault() {} });
  const action = page.request.data.items.find((item) => item[0] === 'action');
  assert.equal(action[1], 'submit_review');
});

test('successive camera or album selections append independent staged files and previews', () => {
  const page = createPage();
  const first = { name: 'image.jpg', size: 10, lastModified: 1 };
  const second = { name: 'image.jpg', size: 10, lastModified: 1 };
  const third = { name: 'third.jpg', size: 15, lastModified: 3 };

  page.input.files = [first];
  page.input.value = 'camera-selection';
  page.input.listeners.change();
  assert.equal(vm.runInContext('stagedFiles.length', page.context), 1);
  assert.equal(page.list.children.length, 1);

  page.input.files = [second];
  page.input.listeners.change();
  assert.equal(vm.runInContext('stagedFiles.length', page.context), 2);
  assert.equal(page.list.children.length, 2);
  assert.equal(page.list.children[0].children[0].src, 'blob:image.jpg');
  assert.equal(page.list.children[1].children[0].src, 'blob:image.jpg');

  page.input.files = [third];
  page.input.listeners.change();
  assert.equal(vm.runInContext('stagedFiles.length', page.context), 3);
  assert.equal(page.input.value, '');
  assert.equal(page.count.textContent, '共 3 / 5 張（已保存 0，待保存 3）');
  assert.equal(page.form.dataset.stagedPhotoCount, '3');
  assert.equal(page.list.dataset.stagedCount, '3');
  assert.equal(page.list.children.length, 3);
  assert.equal(page.list.children[2].children[0].src, 'blob:third.jpg');
  assert.equal(page.list.children[0].children[2].textContent, '×');
  assert.match(page.list.children[0].children[2].attributes['aria-label'], /刪除待提交照片/);
});

test('removing one staged photo preserves the rest and allows a replacement', () => {
  const page = createPage();
  page.input.files = [
    { name: 'first.jpg' },
    { name: 'second.jpg' },
    { name: 'third.jpg' },
  ];
  page.input.listeners.change();
  page.list.children[1].children[2].click();

  assert.equal(vm.runInContext('stagedFiles.length', page.context), 2);
  assert.equal(page.count.textContent, '共 2 / 5 張（已保存 0，待保存 2）');
  assert.deepEqual(page.list.children.map((item) => item.children[0].src), ['blob:first.jpg', 'blob:third.jpg']);

  page.input.files = [{ name: 'replacement.jpg' }];
  page.input.listeners.change();
  assert.equal(vm.runInContext('stagedFiles.length', page.context), 3);
  assert.equal(page.list.children.length, 3);
});

test('album multi-select followed by separate selections appends up to five and rejects a sixth', () => {
  const page = createPage();
  page.input.files = [{ name: 'a.jpg' }, { name: 'b.jpg' }];
  page.input.listeners.change();
  page.input.files = [{ name: 'c.jpg' }];
  page.input.listeners.change();
  page.input.files = [{ name: 'd.jpg' }, { name: 'e.jpg' }, { name: 'f.jpg' }];
  page.input.listeners.change();

  assert.equal(vm.runInContext('stagedFiles.length', page.context), 5);
  assert.equal(page.list.children.length, 5);
  assert.equal(page.count.textContent, '共 5 / 5 張（已保存 0，待保存 5）');
  assert.match(page.status.textContent, /最多上傳5張照片/);
});

test('saved evidence counts toward the five-photo cap and the picker is blocked when full', () => {
  const page = createPage(4);
  page.input.files = [{ name: 'fifth.jpg' }, { name: 'sixth.jpg' }];
  page.input.listeners.change();
  assert.equal(vm.runInContext('stagedFiles.length', page.context), 1);
  assert.equal(page.count.textContent, '共 5 / 5 張（已保存 4，待保存 1）');

  let prevented = false;
  page.picker.listeners.click({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.match(page.status.textContent, /最多上傳5張照片/);
});

test('saving sends each staged photo once and success reloads server-persisted evidence', () => {
  const page = createPage();
  page.input.files = [{ name: 'one.jpg' }, { name: 'two.jpg' }];
  page.input.listeners.change();
  page.submit({ preventDefault() {}, submitter: page.saveButton });

  const uploaded = page.request.data.items.filter((item) => item[0] === 'images');
  assert.deepEqual(uploaded.map((item) => item[2]), ['one.jpg', 'two.jpg']);

  page.request.status = 200;
  page.request.responseText = '{"ok":true}';
  page.request.responseHeaders = { 'Content-Type': 'application/json' };
  page.request.listeners.load();
  assert.equal(page.reloadCount, 1);
});

test('video selection is previewed, can be removed, and is sent once with the form', () => {
  const page = createPage();
  const video = { name: 'flight.MOV', size: 20, lastModified: 9 };
  page.videoInput.files = [video];
  page.videoInput.listeners.change();

  assert.equal(page.videoPreview.hidden, false);
  assert.equal(page.videoPreview.children.length, 2);
  assert.equal(page.videoPreview.children[0].src, 'blob:flight.MOV');
  assert.match(page.videoStatus.textContent, /已加入/);

  page.submit({ preventDefault() {}, submitter: page.saveButton });
  const uploaded = page.request.data.items.filter((item) => item[0] === 'video');
  assert.deepEqual(uploaded.map((item) => item[2]), ['flight.MOV']);
});

test('staged video preview has an independent remove button', () => {
  const page = createPage();
  page.videoInput.files = [{ name: 'replace.mp4' }];
  page.videoInput.listeners.change();
  page.videoPreview.children[1].click();

  assert.equal(page.videoPreview.hidden, true);
  assert.match(page.videoStatus.textContent, /移除/);
});

test('successive document selections append, preview names, remove, and upload once', () => {
  const page = createPage();
  page.documentInput.files = [{ name: '成果.pdf' }];
  page.documentInput.listeners.change();
  page.documentInput.files = [{ name: '簡報.pptx' }];
  page.documentInput.listeners.change();

  assert.equal(vm.runInContext('stagedDocuments.length', page.context), 2);
  assert.equal(page.documentList.children.length, 2);
  assert.equal(page.documentList.children[0].children[0].children[0].textContent, '成果.pdf');
  assert.match(page.documentStatus.textContent, /已選擇 2 個成果檔案/);

  page.documentList.children[0].children[1].click();
  assert.equal(vm.runInContext('stagedDocuments.length', page.context), 1);
  assert.equal(page.documentList.children[0].children[0].children[0].textContent, '簡報.pptx');

  page.submit({ preventDefault() {}, submitter: page.saveButton });
  const uploaded = page.request.data.items.filter((item) => item[0] === 'documents');
  assert.deepEqual(uploaded.map((item) => item[2]), ['簡報.pptx']);
});
