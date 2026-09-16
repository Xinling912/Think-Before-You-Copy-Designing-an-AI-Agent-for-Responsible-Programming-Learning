import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const chunks = fs
  .readFileSync(path.join(repoRoot, 'data', 'processed', 'python-docs-3.14.6', 'chunks.jsonl'), 'utf8')
  .trim()
  .split(/\r?\n/)
  .map((line) => JSON.parse(line));

function referenceFor(fragment) {
  const chunk = chunks.find((item) => item.doc_id.includes(fragment));
  if (!chunk) throw new Error(`Missing official Python documentation chunk for ${fragment}`);
  return {
    source: 'python-official-documentation',
    sourceId: 'python-docs-3.14.6',
    sourceUrl: chunk.source_url,
    evidenceChunkId: chunk.chunk_id,
  };
}

const refs = {
  foundations: referenceFor('tutorial:introduction'),
  collections: referenceFor('tutorial:datastructures'),
  control: referenceFor('tutorial:controlflow'),
  modules: referenceFor('tutorial:modules'),
  errors: referenceFor('tutorial:errors'),
  files: referenceFor('tutorial:inputoutput'),
  classes: referenceFor('tutorial:classes'),
};

const groups = [
  {
    key: 'foundations',
    topic: 'program-foundations',
    ids: [
      'Concept:program', 'Concept:statement', 'Concept:expression', 'Concept:variable', 'Concept:assignment',
      'Concept:name_binding', 'Concept:comment', 'Concept:indentation', 'Concept:input', 'Concept:output_print',
    ],
    base: ['Concept:program', 'Concept:statement'],
    extensions: ['Concept:expression', 'Concept:variable', 'Concept:assignment'],
    pathCount: 16,
  },
  {
    key: 'foundations',
    topic: 'types-and-values',
    ids: [
      'Concept:object', 'Concept:type', 'Concept:int', 'Concept:float', 'Concept:complex', 'Concept:boolean',
      'Concept:none', 'Concept:string', 'Concept:type_conversion', 'Concept:operator', 'Concept:arithmetic_operator',
      'Concept:comparison_operator', 'Concept:logical_operator',
    ],
    base: ['Concept:expression', 'Concept:object'],
    extensions: ['Concept:type', 'Concept:operator', 'Concept:type_conversion'],
    pathCount: 24,
  },
  {
    key: 'collections',
    topic: 'collections-and-access',
    ids: [
      'Concept:sequence', 'Concept:list', 'Concept:tuple', 'Concept:dict', 'Concept:set', 'Concept:key',
      'Concept:value', 'Concept:membership', 'Concept:index', 'Concept:zero_based_index', 'Concept:valid_index_range',
      'Concept:slice', 'Concept:len', 'Concept:mutability', 'Concept:list_method', 'Concept:dict_method',
    ],
    base: ['Concept:object', 'Concept:type'],
    extensions: ['Concept:sequence', 'Concept:for_loop', 'Concept:list_comprehension'],
    pathCount: 40,
  },
  {
    key: 'control',
    topic: 'control-flow',
    ids: [
      'Concept:condition', 'Concept:if_statement', 'Concept:elif_clause', 'Concept:else_clause', 'Concept:for_loop',
      'Concept:while_loop', 'Concept:range', 'Concept:enumerate', 'Concept:break', 'Concept:continue',
      'Concept:loop_variable', 'Concept:iteration', 'Concept:list_comprehension',
    ],
    base: ['Concept:statement', 'Concept:expression'],
    extensions: ['Concept:condition', 'Concept:iteration', 'Concept:function'],
    pathCount: 28,
  },
  {
    key: 'control',
    topic: 'functions-and-modules',
    ids: [
      'Concept:function', 'Concept:function_definition', 'Concept:function_call', 'Concept:parameter',
      'Concept:argument', 'Concept:default_argument', 'Concept:return_value', 'Concept:scope',
      'Concept:local_variable', 'Concept:global_variable', 'Concept:module', 'Concept:import_statement',
      'Concept:library_function',
    ],
    base: ['Concept:statement', 'Concept:variable'],
    extensions: ['Concept:function_call', 'Concept:return_value', 'Concept:module'],
    pathCount: 24,
  },
  {
    key: 'errors',
    topic: 'errors-files-and-classes',
    ids: [
      'Concept:traceback', 'Concept:debugging', 'Concept:file', 'Concept:file_open', 'Concept:file_read',
      'Concept:file_write', 'Concept:class', 'Concept:instance', 'Concept:attribute', 'ErrorType:IndexError',
      'ErrorType:KeyError', 'ErrorType:NameError', 'ErrorType:TypeError', 'ErrorType:SyntaxError',
      'ErrorType:ValueError', 'Misconception:index_starts_at_one', 'Misconception:off_by_one',
      'Misconception:assignment_vs_equality',
    ],
    base: ['Concept:statement', 'Concept:traceback'],
    extensions: ['Concept:debugging', 'Concept:function', 'Concept:class'],
    pathCount: 28,
  },
];

const specialLabels = {
  'Concept:output_print': 'print output',
  'Concept:none': 'None',
  'Concept:int': 'int',
  'Concept:dict': 'dictionary',
  'Concept:len': 'len',
  'Concept:for_loop': 'for loop',
  'Concept:while_loop': 'while loop',
  'Concept:if_statement': 'if statement',
  'Concept:elif_clause': 'elif clause',
  'Concept:else_clause': 'else clause',
  'Concept:function_definition': 'function definition',
  'Concept:function_call': 'function call',
  'Concept:import_statement': 'import statement',
  'Concept:file_open': 'open a file',
  'Concept:file_read': 'read a file',
  'Concept:file_write': 'write a file',
  'Concept:zero_based_index': 'zero-based index',
  'Concept:valid_index_range': 'valid index range',
  'Concept:list_comprehension': 'list comprehension',
  'Misconception:index_starts_at_one': 'index starts at one misconception',
  'Misconception:off_by_one': 'off-by-one error',
  'Misconception:assignment_vs_equality': 'assignment versus equality misconception',
};

const bilingualAliases = {
  'Concept:variable': ['变量'],
  'Concept:assignment': ['赋值'],
  'Concept:string': ['字符串'],
  'Concept:boolean': ['布尔值'],
  'Concept:list': ['列表'],
  'Concept:tuple': ['元组'],
  'Concept:dict': ['字典'],
  'Concept:set': ['集合'],
  'Concept:index': ['索引', '下标'],
  'Concept:zero_based_index': ['从零开始的索引'],
  'Concept:valid_index_range': ['越界', '索引越界', '下标越界', '合法索引范围'],
  'Concept:slice': ['切片'],
  'Concept:for_loop': ['for 循环'],
  'Concept:while_loop': ['while 循环'],
  'Concept:if_statement': ['条件语句'],
  'Concept:function': ['函数'],
  'Concept:parameter': ['参数'],
  'Concept:argument': ['实参'],
  'Concept:traceback': ['回溯', '错误栈'],
  'Concept:debugging': ['调试'],
  'ErrorType:IndexError': ['索引越界错误'],
  'ErrorType:NameError': ['名称错误'],
  'ErrorType:TypeError': ['类型错误'],
  'ErrorType:SyntaxError': ['语法错误'],
};

function labelFor(id) {
  return specialLabels[id] || id.split(':')[1].replaceAll('_', ' ');
}

function sourceKeyFor(id, fallbackKey) {
  if (id.startsWith('Concept:file')) return 'files';
  if (['Concept:class', 'Concept:instance', 'Concept:attribute'].includes(id)) return 'classes';
  return fallbackKey;
}

function yamlQuote(value) {
  return JSON.stringify(value);
}

function yamlList(values) {
  return `[${values.map(yamlQuote).join(', ')}]`;
}

const nodes = groups.flatMap((group) => group.ids.map((id) => ({ id, group })));
if (nodes.length !== 83) throw new Error(`Expected 83 nodes, got ${nodes.length}`);
if (new Set(nodes.map((node) => node.id)).size !== nodes.length) throw new Error('Duplicate node id');

const conceptsYaml = ['concepts:'];
for (const { id, group } of nodes) {
  const ref = refs[sourceKeyFor(id, group.key)];
  const label = labelFor(id);
  const aliases = [label, id.split(':')[1], label.replaceAll(' ', '_'), ...(bilingualAliases[id] || [])]
    .filter((value, index, values) => value && values.indexOf(value) === index);
  conceptsYaml.push(
    `  - id: ${yamlQuote(id)}`,
    `    label_en: ${yamlQuote(label)}`,
    `    aliases: ${yamlList(aliases)}`,
    `    source: ${yamlQuote(ref.source)}`,
    `    source_url: ${yamlQuote(ref.sourceUrl)}`,
    `    evidence_chunk_id: ${yamlQuote(ref.evidenceChunkId)}`,
  );
}

const paths = [];
const entryPrerequisites = {
  'program-foundations': ['Concept:input', 'Concept:output_print'],
  'types-and-values': ['Concept:expression', 'Concept:variable'],
  'collections-and-access': ['Concept:object', 'Concept:type'],
  'control-flow': ['Concept:statement', 'Concept:expression'],
  'functions-and-modules': ['Concept:statement', 'Concept:variable'],
  'errors-files-and-classes': ['Concept:statement', 'Concept:expression'],
};

const coreRoutes = {
  'Concept:list': { upstream: ['Concept:object', 'Concept:type', 'Concept:sequence'], downstream: ['Concept:index', 'Concept:len', 'Concept:mutability'] },
  'Concept:dict': { upstream: ['Concept:object', 'Concept:type'], downstream: ['Concept:key', 'Concept:value', 'Concept:dict_method'] },
  'Concept:index': { upstream: ['Concept:list', 'Concept:sequence'], downstream: ['Concept:zero_based_index', 'Concept:valid_index_range'] },
  'Concept:zero_based_index': { upstream: ['Concept:list', 'Concept:index'], downstream: ['Concept:valid_index_range', 'ErrorType:IndexError'] },
  'Concept:valid_index_range': { upstream: ['Concept:list', 'Concept:zero_based_index', 'Concept:len'], downstream: ['ErrorType:IndexError', 'Concept:debugging'] },
  'Concept:len': { upstream: ['Concept:sequence', 'Concept:list'], downstream: ['Concept:valid_index_range', 'Concept:for_loop'] },
  'Concept:slice': { upstream: ['Concept:sequence', 'Concept:index'], downstream: ['Concept:list_method', 'Concept:mutability'] },
  'Concept:for_loop': { upstream: ['Concept:sequence', 'Concept:list'], downstream: ['Concept:loop_variable', 'Concept:iteration', 'Concept:range'] },
  'Concept:while_loop': { upstream: ['Concept:condition', 'Concept:if_statement'], downstream: ['Concept:iteration', 'Concept:break', 'Concept:continue'] },
  'Concept:if_statement': { upstream: ['Concept:condition', 'Concept:comparison_operator'], downstream: ['Concept:elif_clause', 'Concept:else_clause'] },
  'Concept:function': { upstream: ['Concept:statement', 'Concept:variable'], downstream: ['Concept:function_definition', 'Concept:function_call'] },
  'Concept:function_definition': { upstream: ['Concept:function', 'Concept:parameter'], downstream: ['Concept:return_value', 'Concept:scope'] },
  'Concept:function_call': { upstream: ['Concept:function', 'Concept:argument'], downstream: ['Concept:return_value', 'Concept:library_function'] },
  'Concept:parameter': { upstream: ['Concept:function_definition'], downstream: ['Concept:argument', 'Concept:default_argument'] },
  'Concept:module': { upstream: ['Concept:function', 'Concept:scope'], downstream: ['Concept:import_statement', 'Concept:library_function'] },
  'Concept:traceback': { upstream: ['Concept:statement', 'Concept:expression'], downstream: ['Concept:debugging', 'ErrorType:SyntaxError'] },
  'Concept:debugging': { upstream: ['Concept:traceback', 'ErrorType:TypeError'], downstream: ['Concept:valid_index_range', 'Concept:function'] },
  'ErrorType:IndexError': { upstream: ['Concept:list', 'Concept:zero_based_index', 'Concept:valid_index_range'], downstream: ['Concept:debugging', 'Misconception:off_by_one'] },
  'ErrorType:KeyError': { upstream: ['Concept:dict', 'Concept:key'], downstream: ['Concept:debugging', 'Concept:dict_method'] },
  'ErrorType:NameError': { upstream: ['Concept:variable', 'Concept:name_binding', 'Concept:scope'], downstream: ['Concept:debugging', 'Concept:global_variable'] },
  'ErrorType:TypeError': { upstream: ['Concept:object', 'Concept:type', 'Concept:operator'], downstream: ['Concept:debugging', 'Concept:type_conversion'] },
  'ErrorType:SyntaxError': { upstream: ['Concept:statement', 'Concept:indentation'], downstream: ['Concept:traceback', 'Concept:debugging'] },
  'Concept:file': { upstream: ['Concept:string', 'Concept:variable'], downstream: ['Concept:file_open', 'Concept:file_read'] },
  'Concept:file_open': { upstream: ['Concept:file', 'Concept:string'], downstream: ['Concept:file_read', 'Concept:file_write'] },
  'Concept:file_read': { upstream: ['Concept:file_open'], downstream: ['Concept:for_loop', 'Concept:string'] },
  'Concept:file_write': { upstream: ['Concept:file_open', 'Concept:string'], downstream: ['Concept:output_print', 'Concept:function'] },
  'Concept:class': { upstream: ['Concept:object', 'Concept:function'], downstream: ['Concept:instance', 'Concept:attribute'] },
  'Concept:instance': { upstream: ['Concept:class'], downstream: ['Concept:attribute', 'Concept:function_call'] },
  'Concept:attribute': { upstream: ['Concept:class', 'Concept:instance'], downstream: ['Concept:function_call', 'Concept:debugging'] },
};

function routeGroups(group, focus, variation) {
  const override = coreRoutes[focus];
  if (override && variation === 0) return override;

  const focusIndex = group.ids.indexOf(focus);
  const preceding = group.ids.slice(Math.max(0, focusIndex - 2 - variation), focusIndex);
  const following = group.ids.slice(focusIndex + 1, focusIndex + 3 + variation);
  const upstream = preceding.length ? preceding : entryPrerequisites[group.topic];
  const downstream = following.length ? following : group.extensions;
  return {
    upstream: upstream.filter((node, index, values) => node !== focus && values.indexOf(node) === index),
    downstream: downstream.filter((node, index, values) => node !== focus && !upstream.includes(node) && values.indexOf(node) === index),
  };
}

for (const group of groups) {
  for (let index = 0; index < group.pathCount; index += 1) {
    const focus = group.ids[index % group.ids.length];
    const ref = refs[sourceKeyFor(focus, group.key)];
    const variation = Math.floor(index / group.ids.length);
    const { upstream, downstream } = routeGroups(group, focus, variation);
    if (!upstream.length || !downstream.length) throw new Error(`Invalid path groups for ${focus}`);
    const id = `path-${group.topic}-${String(index + 1).padStart(2, '0')}-${focus.split(':')[1]}`;
    paths.push({
      id,
      label: `${labelFor(focus)} learning route ${index + 1}`,
      topic: group.topic,
      upstream,
      focus: [focus],
      downstream,
      sourceId: ref.sourceId,
      sourceUrl: ref.sourceUrl,
      evidenceChunkIds: [ref.evidenceChunkId],
    });
  }
}

if (paths.length !== 160) throw new Error(`Expected 160 paths, got ${paths.length}`);
if (new Set(paths.map((pathItem) => pathItem.id)).size !== paths.length) throw new Error('Duplicate path id');
const sequences = paths.map((pathItem) => JSON.stringify([pathItem.upstream, pathItem.focus, pathItem.downstream]));
if (new Set(sequences).size !== sequences.length) throw new Error('Duplicate three-group path sequence');

const pathsYaml = ['paths:'];
for (const pathItem of paths) {
  pathsYaml.push(
    `  - id: ${yamlQuote(pathItem.id)}`,
    `    label_en: ${yamlQuote(pathItem.label)}`,
    `    topic: ${yamlQuote(pathItem.topic)}`,
    `    upstream: ${yamlList(pathItem.upstream)}`,
    `    focus: ${yamlList(pathItem.focus)}`,
    `    downstream: ${yamlList(pathItem.downstream)}`,
    `    source_id: ${yamlQuote(pathItem.sourceId)}`,
    `    source_url: ${yamlQuote(pathItem.sourceUrl)}`,
    `    evidence_chunk_ids: ${yamlList(pathItem.evidenceChunkIds)}`,
  );
}

fs.writeFileSync(path.join(repoRoot, 'kg', 'concepts.yaml'), `${conceptsYaml.join('\n')}\n`, 'utf8');
fs.writeFileSync(path.join(repoRoot, 'kg', 'learning_paths.yaml'), `${pathsYaml.join('\n')}\n`, 'utf8');
const graphEdges = new Map();
const baseTeachingEdges = [
  ['Concept:list', 'requires', 'Concept:object', 1],
  ['Concept:list', 'related_to', 'Concept:type', 1],
  ['Concept:index', 'requires', 'Concept:list', 1],
  ['Concept:zero_based_index', 'constrains', 'Concept:index', 1],
  ['Concept:valid_index_range', 'combines', 'Concept:zero_based_index', 1],
  ['Concept:valid_index_range', 'uses', 'Concept:len', 1],
  ['Concept:slice', 'requires', 'Concept:index', 1],
  ['Concept:len', 'related_to', 'Concept:list', 4],
  ['Concept:for_loop', 'related_to', 'Concept:list', 1],
  ['Concept:while_loop', 'related_to', 'Concept:if_statement', 1],
  ['Concept:range', 'related_to', 'Concept:for_loop', 1],
  ['Concept:enumerate', 'related_to', 'Concept:for_loop', 1],
  ['ErrorType:IndexError', 'caused_by', 'Concept:index', 5],
  ['ErrorType:IndexError', 'caused_by', 'Concept:valid_index_range', 1],
  ['Concept:valid_index_range', 'prevents', 'ErrorType:IndexError', 1],
  ['Misconception:index_starts_at_one', 'causes_error', 'ErrorType:IndexError', 1],
  ['Misconception:off_by_one', 'causes_error', 'ErrorType:IndexError', 1],
  ['Concept:program', 'contains', 'Concept:statement', 1],
  ['Concept:statement', 'uses', 'Concept:expression', 1],
  ['Concept:assignment', 'binds', 'Concept:name_binding', 1],
  ['Concept:variable', 'refers_to', 'Concept:object', 1],
  ['Concept:object', 'has', 'Concept:type', 1],
  ['Concept:list', 'is_a', 'Concept:sequence', 1],
  ['Concept:tuple', 'is_a', 'Concept:sequence', 1],
  ['Concept:string', 'is_a', 'Concept:sequence', 1],
  ['Concept:index', 'selects_from', 'Concept:sequence', 1],
  ['Concept:traceback', 'reveals', 'ErrorType:IndexError', 1],
  ['Concept:traceback', 'reveals', 'ErrorType:TypeError', 1],
  ['Concept:traceback', 'reveals', 'ErrorType:NameError', 1],
  ['Concept:traceback', 'reveals', 'ErrorType:SyntaxError', 1],
  ['Concept:debugging', 'uses', 'Concept:traceback', 1],
  ['Concept:condition', 'controls', 'Concept:if_statement', 1],
  ['Concept:condition', 'controls', 'Concept:while_loop', 1],
  ['Concept:for_loop', 'iterates', 'Concept:sequence', 1],
  ['Concept:function', 'defines', 'Concept:parameter', 1],
  ['Concept:function_call', 'passes', 'Concept:argument', 1],
  ['Concept:argument', 'fills', 'Concept:parameter', 1],
  ['Concept:function', 'can_return', 'Concept:return_value', 1],
  ['Concept:function', 'introduces', 'Concept:scope', 1],
  ['ErrorType:NameError', 'caused_by', 'Concept:name_binding', 1],
  ['ErrorType:TypeError', 'caused_by', 'Concept:type', 1],
  ['ErrorType:SyntaxError', 'caused_by', 'Concept:statement', 1],
];
for (const [from, predicate, to, weight] of baseTeachingEdges) {
  graphEdges.set(`${from}|${predicate}|${to}`, { from, predicate, to, weight });
}
for (const pathItem of paths) {
  const sequence = [...pathItem.upstream, ...pathItem.focus, ...pathItem.downstream];
  for (let index = 0; index < sequence.length - 1; index += 1) {
    const from = sequence[index];
    const to = sequence[index + 1];
    const predicate = pathItem.focus.includes(to)
      ? 'requires'
      : pathItem.focus.includes(from)
        ? 'extends_to'
        : 'related_to';
    graphEdges.set(`${from}|${predicate}|${to}`, { from, predicate, to, weight: 100 });
  }
}
const edgesYaml = ['# Source-grounded prerequisite and extension relations for the beginner Python curriculum.', 'edges:'];
for (const edge of [...graphEdges.values()].sort((left, right) => `${left.from}|${left.to}`.localeCompare(`${right.from}|${right.to}`))) {
  edgesYaml.push(
    `  - from: ${yamlQuote(edge.from)}`,
    `    type: ${yamlQuote(edge.predicate)}`,
    `    to: ${yamlQuote(edge.to)}`,
    `    weight: ${edge.weight}`,
  );
}
fs.writeFileSync(path.join(repoRoot, 'kg', 'edges.yaml'), `${edgesYaml.join('\n')}\n`, 'utf8');
console.log(JSON.stringify({ nodes: nodes.length, paths: paths.length, references: refs }, null, 2));
