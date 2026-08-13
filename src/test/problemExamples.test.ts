import { describe, expect, it } from 'vitest';
import {
  extractProblemExamples,
  mergeProblemExamples,
  normalizeProblemExamples,
} from '../lib/problemExamples';

describe('题目样例解析', () => {
  it('解析中文标签、全角冒号和解释', () => {
    expect(extractProblemExamples(`
示例 1：
输入： nums = [2,7,11,15], target = 9
输出： [0,1]
解释： 因为 nums[0] + nums[1] == 9，所以返回 [0,1]。
    `)).toEqual([{
      input: 'nums = [2,7,11,15], target = 9',
      output: '[0,1]',
      explanation: '因为 nums[0] + nums[1] == 9，所以返回 [0,1]。',
    }]);
  });

  it('解析英文标签、半角冒号和多行字段', () => {
    expect(extractProblemExamples(`
Example 1:
Input:
nums = [3,2,4]
target = 6
Output:
[1,2]
Explanation:
The values at indices 1 and 2 add up to 6.
    `)).toEqual([{
      input: 'nums = [3,2,4]\ntarget = 6',
      output: '[1,2]',
      explanation: 'The values at indices 1 and 2 add up to 6.',
    }]);
  });

  it('按示例标题解析多个样例并在提示或约束段停止', () => {
    expect(extractProblemExamples(`
示例一
输入: 2 3
输出: 5

Example 2：
Input: 10 20
Output: 30

提示：
答案不会溢出。
Example 3:
Input: 1 1
Output: 2
    `)).toEqual([
      { input: '2 3', output: '5' },
      { input: '10 20', output: '30' },
    ]);

    expect(extractProblemExamples(`
Input: [1,2,3]
Output: 6
Constraints:
1 <= nums.length <= 100
Input: [4]
Output: 4
    `)).toEqual([{ input: '[1,2,3]', output: '6' }]);
  });

  it('只保留输入输出成对且 trim 后非空的样例', () => {
    expect(extractProblemExamples(`
示例 1：
输入： only-input
示例 2：
输入： valid-input
输出： valid-output
示例 3：
输入：
输出： empty-input
示例 4：
输入： output-is-empty
输出：
    `)).toEqual([{ input: 'valid-input', output: 'valid-output' }]);
  });

  it('忽略样例字段前的约束段并识别样例和 Sample 标题', () => {
    expect(extractProblemExamples(`
约束：
1 <= n <= 100

样例 1：
输入： 1
输出： 2

Sample 2:
Input: 3
Output: 4
    `)).toEqual([
      { input: '1', output: '2' },
      { input: '3', output: '4' },
    ]);
  });

  it.each(['约束：', 'Hint:', 'Note:'])('发现样例字段后按 %s 截断', (stopHeading) => {
    expect(extractProblemExamples(`
Sample 1:
Input: kept
Output: kept
${stopHeading}
Input: ignored
Output: ignored
    `)).toEqual([{ input: 'kept', output: 'kept' }]);
  });

  it('在线性时间内拒绝超长空白后的无效标签', () => {
    const invalidLine = `${' '.repeat(40_000)}Invalid label: value`;
    const startedAt = performance.now();

    expect(extractProblemExamples(invalidLine)).toEqual([]);

    expect(performance.now() - startedAt).toBeLessThan(750);
  });

  it('在线性时间内拒绝 Example 标题超长空白后的无效内容', () => {
    const invalidHeading = `Example${' '.repeat(40_000)}Invalid`;
    const startedAt = performance.now();

    expect(extractProblemExamples(invalidHeading)).toEqual([]);

    expect(performance.now() - startedAt).toBeLessThan(750);
  });

  it.each(['Example #:', 'Sample #'])(
    '将独占标题 %s 识别为样例分隔符且不写入前一输出',
    (heading) => {
      expect(extractProblemExamples(`
Example 1:
Input: first-input
Output: first-output
${heading}
Input: second-input
Output: second-output
      `)).toEqual([
        { input: 'first-input', output: 'first-output' },
        { input: 'second-input', output: 'second-output' },
      ]);
    },
  );
});

describe('题目样例规范化', () => {
  it('裁剪字段、移除空解释并丢弃不完整样例', () => {
    expect(normalizeProblemExamples([
      { input: '  a  ', output: '  b\n ', explanation: '  why  ' },
      { input: 'x', output: 'y', explanation: '   ' },
      { input: '   ', output: 'invalid' },
      { input: 'invalid', output: '' },
    ])).toEqual([
      { input: 'a', output: 'b', explanation: 'why' },
      { input: 'x', output: 'y' },
    ]);
  });

  it('ASCII 字段最多保留 20KB', () => {
    const longValue = 'a'.repeat(20 * 1024 + 100);
    const [example] = normalizeProblemExamples([{
      input: longValue,
      output: longValue,
      explanation: longValue,
    }]);

    expect(example.input).toHaveLength(20 * 1024);
    expect(example.output).toHaveLength(20 * 1024);
    expect(example.explanation).toHaveLength(20 * 1024);
  });

  it('按 UTF-8 字节限制字段且不会截断单码点 emoji 或代理对', () => {
    const prefix = 'a'.repeat(20 * 1024 - 1);
    const longValue = `${prefix}🙂`;
    const [example] = normalizeProblemExamples([{
      input: longValue,
      output: longValue,
      explanation: longValue,
    }]);

    expect(example).toEqual({ input: prefix, output: prefix, explanation: prefix });
    expect(new TextEncoder().encode(example.input)).toHaveLength(20 * 1024 - 1);
    expect(new TextEncoder().encode(example.output)).toHaveLength(20 * 1024 - 1);
    expect(new TextEncoder().encode(example.explanation)).toHaveLength(20 * 1024 - 1);
  });

  it('最多保留 20 条并按规范化输入输出去重', () => {
    const examples = Array.from({ length: 25 }, (_, index) => ({
      input: ` ${index} `,
      output: ` ${index * 2} `,
    }));
    examples.splice(1, 0, { input: '0', output: '0' });

    const normalized = normalizeProblemExamples(examples);

    expect(normalized).toHaveLength(20);
    expect(normalized[0]).toEqual({ input: '0', output: '0' });
    expect(normalized.at(-1)).toEqual({ input: '19', output: '38' });
  });

  it('输入输出包含 NUL 时使用无碰撞去重键', () => {
    expect(normalizeProblemExamples([
      { input: 'a', output: 'b\0c' },
      { input: 'a\0b', output: 'c' },
    ])).toEqual([
      { input: 'a', output: 'b\0c' },
      { input: 'a\0b', output: 'c' },
    ]);
  });
});

describe('题目样例合并', () => {
  it('按规范化输入输出去重且 existing 优先', () => {
    expect(mergeProblemExamples(
      [{ input: '  [1,2] ', output: ' 3 ', explanation: '已有解释' }],
      [
        { input: '[1,2]', output: '3', explanation: '新解释' },
        { input: '[4]', output: '4' },
      ],
    )).toEqual([
      { input: '[1,2]', output: '3', explanation: '已有解释' },
      { input: '[4]', output: '4' },
    ]);
  });

  it('合并结果同样最多保留 20 条', () => {
    const existing = Array.from({ length: 15 }, (_, index) => ({ input: `e${index}`, output: `${index}` }));
    const incoming = Array.from({ length: 10 }, (_, index) => ({ input: `i${index}`, output: `${index}` }));

    const merged = mergeProblemExamples(existing, incoming);

    expect(merged).toHaveLength(20);
    expect(merged.at(-1)).toEqual({ input: 'i4', output: '4' });
  });
});
