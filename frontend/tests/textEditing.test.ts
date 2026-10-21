import assert from 'node:assert/strict';
import test from 'node:test';
import { chooserKey, paragraphChoices, pasteCaret } from '../src/lib/textEditing.ts';

test('粘贴焦点按码点定位到最后一段插入末尾，保留空行', () => {
  assert.equal(pasteCaret('中😀', 3), 5);
  assert.equal(pasteCaret('一\n\n尾😀', 3), 2);
  assert.equal(pasteCaret('一\n', 3), 0);
});

test('新段落默认为正文，数字及方向键只选择，回车才确认', () => {
  assert.equal(paragraphChoices[0].role, 'body');
  assert.deepEqual(chooserKey('2', 0, false), { action: 'select', selected: 1 });
  assert.equal(paragraphChoices[1].level, 1);
  assert.deepEqual(chooserKey('Enter', 1, false), { action: 'confirm', selected: 1 });
  assert.equal(chooserKey('ArrowLeft', 0, false).selected, paragraphChoices.length - 1);
  assert.equal(chooserKey('ArrowRight', paragraphChoices.length - 1, false).selected, 0);
  assert.equal(paragraphChoices[4].role, 'title');
});

test('组合输入不触发类别快捷键，正文文字与 Escape 可收起选择器', () => {
  for (const key of ['1', 'Enter', 'ArrowLeft']) assert.equal(chooserKey(key, 0, true).action, 'ignore');
  assert.equal(chooserKey('正', 0, false).action, 'type');
  assert.equal(chooserKey('Escape', 0, false).action, 'close');
});
