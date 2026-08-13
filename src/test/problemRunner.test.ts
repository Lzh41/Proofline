import { describe, expect, it } from 'vitest';
import {
  buildCppFunctionHarness,
  buildJavaScriptFunctionHarness,
  buildPythonFunctionHarness,
  formatProblemSampleResult,
  outputsEqual,
  parseCppFunctionSignature,
} from '../lib/problemRunner';

describe('题目函数自动测试适配器', () => {
  it('识别 LeetCode Solution 方法并自动生成 main', () => {
    const code = `class Solution {
public:
  vector<int> twoSum(vector<int>& nums, int target) {
    unordered_map<int, int> seen;
    for (int i = 0; i < nums.size(); ++i) {
      if (seen.count(target - nums[i])) return {seen[target - nums[i]], i};
      seen[nums[i]] = i;
    }
    return {};
  }
};`;
    const harness = buildCppFunctionHarness(code, 'nums = [2,7,11,15], target = 9');
    expect(harness.signature.name).toBe('twoSum');
    expect(harness.signature.parameters.map((item) => item.name)).toEqual(['nums', 'target']);
    expect(harness.source).toContain('vector<int> proofline_arg_0 = vector<int>{2, 7, 11, 15};');
    expect(harness.source).toContain('int proofline_arg_1 = 9;');
    expect(harness.source).toContain('proofline_solution.twoSum(proofline_arg_0, proofline_arg_1)');
    expect(harness.source).toContain('int main()');
  });

  it('支持普通解题函数、字符串和二维数组参数', () => {
    const code = `string solve(vector<vector<int>>& grid, string prefix) {
  return prefix + to_string(grid.size());
}`;
    const harness = buildCppFunctionHarness(code, 'grid = [[1,2],[3,4]], prefix = "n="');
    expect(harness.signature.owner).toBe('free');
    expect(harness.source).toContain('vector<vector<int>>{vector<int>{1, 2}, vector<int>{3, 4}}');
    expect(harness.source).toContain('string proofline_arg_1 = "n=";');
    expect(harness.source).toContain('solve(proofline_arg_0, proofline_arg_1)');
  });

  it('void 函数会输出第一个可变引用参数', () => {
    const code = `class Solution {
public:
  void sortColors(vector<int>& nums) { sort(nums.begin(), nums.end()); }
};`;
    const harness = buildCppFunctionHarness(code, 'nums = [2,0,1]');
    expect(harness.source).toContain('proofline_solution.sortColors(proofline_arg_0);');
    expect(harness.source).toContain('proofline_print(proofline_arg_0);');
  });

  it('JavaScript 平台函数会自动调用并输出 JSON', () => {
    const harness = buildJavaScriptFunctionHarness(
      'var twoSum = function(nums, target) { return [0, 1]; };',
      'nums = [2,7,11,15], target = 9',
    );
    expect(harness.signature.name).toBe('twoSum');
    expect(harness.source).toContain('const __proofline_args = [[2,7,11,15],9];');
    expect(harness.source).toContain('twoSum(...__proofline_args)');
    expect(harness.source).toContain('console.log(JSON.stringify(__proofline_result))');
  });

  it('TypeScript Solution 方法会自动调用', () => {
    const harness = buildJavaScriptFunctionHarness(
      'class Solution { public twoSum(nums: number[], target: number): number[] { return [0, 1]; } }',
      'nums = [2,7], target = 9',
    );
    expect(harness.signature.owner).toBe('solution');
    expect(harness.source).toContain('new Solution().twoSum(...__proofline_args)');
  });

  it('Python Solution 方法会自动调用并输出紧凑 JSON', () => {
    const harness = buildPythonFunctionHarness(
      'class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        return [0, 1]',
      'nums = [2,7], target = 9',
    );
    expect(harness.signature.parameters).toEqual(['nums', 'target']);
    expect(harness.source).toContain('Solution().twoSum(*__proofline_args)');
    expect(harness.source).toContain("separators=(',', ':')");
  });

  it('Python 链表题会把数组样例转换成 ListNode 并把返回链表转回数组', () => {
    const harness = buildPythonFunctionHarness(
      [
        'class Solution:',
        '    def addTwoNumbers(self, l1: Optional[ListNode], l2: Optional[ListNode]) -> Optional[ListNode]:',
        '        carry = 0',
        '        dummy = ListNode()',
        '        tail = dummy',
        '        while l1 or l2 or carry:',
        '            total = carry + (l1.val if l1 else 0) + (l2.val if l2 else 0)',
        '            carry = total // 10',
        '            tail.next = ListNode(total % 10)',
        '            tail = tail.next',
        '            l1 = l1.next if l1 else None',
        '            l2 = l2.next if l2 else None',
        '        return dummy.next',
      ].join('\n'),
      'l1 = [2,4,3], l2 = [5,6,4]',
    );

    expect(harness.source).toContain('class ListNode:');
    expect(harness.source).toContain('__proofline_arg_kinds = ["listnode","listnode"]');
    expect(harness.source).toContain('__proofline_return_kind = "listnode"');
    expect(harness.source).toContain('__proofline_make_list_node');
    expect(harness.source).toContain('__proofline_list_node_to_array');
  });

  it('Python 二叉树题会把层序数组样例转换成 TreeNode 并把返回树转回数组', () => {
    const harness = buildPythonFunctionHarness(
      [
        'class Solution:',
        '    def invertTree(self, root: Optional[TreeNode]) -> Optional[TreeNode]:',
        '        if root:',
        '            root.left, root.right = self.invertTree(root.right), self.invertTree(root.left)',
        '        return root',
      ].join('\n'),
      'root = [4,2,7,1,3,6,9]',
    );

    expect(harness.source).toContain('class TreeNode:');
    expect(harness.source).toContain('__proofline_arg_kinds = ["treenode"]');
    expect(harness.source).toContain('__proofline_return_kind = "treenode"');
    expect(harness.source).toContain('__proofline_make_tree_node');
    expect(harness.source).toContain('__proofline_tree_node_to_array');
  });

  it('JavaScript 链表题会根据 JSDoc 生成 ListNode 适配入口', () => {
    const harness = buildJavaScriptFunctionHarness(
      [
        '/**',
        ' * @param {ListNode} l1',
        ' * @param {ListNode} l2',
        ' * @return {ListNode}',
        ' */',
        'var addTwoNumbers = function(l1, l2) { return l1; };',
      ].join('\n'),
      'l1 = [2,4,3], l2 = [5,6,4]',
    );

    expect(harness.source).toContain('function ListNode');
    expect(harness.source).toContain('const __proofline_arg_kinds = ["listnode","listnode"];');
    expect(harness.source).toContain('const __proofline_return_kind = "listnode";');
    expect(harness.source).toContain('__prooflineMakeListNode');
    expect(harness.source).toContain('__prooflineListNodeToArray');
  });

  it('TypeScript 二叉树题会根据类型标注生成 TreeNode 适配入口', () => {
    const harness = buildJavaScriptFunctionHarness(
      'class Solution { invertTree(root: TreeNode | null): TreeNode | null { return root; } }',
      'root = [4,2,7,1,3,6,9]',
    );

    expect(harness.source).toContain('function TreeNode');
    expect(harness.source).toContain('const __proofline_arg_kinds = ["treenode"];');
    expect(harness.source).toContain('const __proofline_return_kind = "treenode";');
    expect(harness.source).toContain('__prooflineMakeTreeNode');
    expect(harness.source).toContain('__prooflineTreeNodeToArray');
  });

  it('缺少签名时返回明确错误而不猜参数类型', () => {
    expect(() => parseCppFunctionSignature('// 只写了一段思路\nint answer = 0;', '[1,2]'))
      .toThrow('没有识别到可测试的解题函数');
  });

  it('不支持的参数类型会阻止生成错误测试入口', () => {
    const code = 'class Solution { public: CustomType solve(CustomType value) { return value; } };';
    expect(() => buildCppFunctionHarness(code, 'value = {"x": 1}'))
      .toThrow('暂不支持自动构造参数类型 CustomType');
  });

  it('比较样例输出时忽略 JSON 排版和普通空白差异', () => {
    expect(outputsEqual('[0,1]', '[0, 1]')).toBe(true);
    expect(outputsEqual('输出： 42', '42')).toBe(true);
    expect(outputsEqual('[0,2]', '[0,1]')).toBe(false);
  });

  it('没有预期输出时明确显示无法判定而不是冒充通过', () => {
    const message = formatProblemSampleResult({
      ok: true,
      output: '3',
      actualOutput: '3',
      expectedOutput: '',
      durationMs: 2,
      timedOut: false,
      sampleIndex: 0,
      generatedEntryPoint: true,
      mode: 'function',
    });
    expect(message).toContain('无法自动判定');
    expect(message).not.toContain('样例 1 通过');
  });
});
