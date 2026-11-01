// Renders docs/sdlc.md from a valid contract: deterministic, in YAML order, LF line endings (plan, decision 7).

const NOTICE =
  '<!-- Generated from contract/*.yaml by scripts/render-docs.mjs. Do not edit by hand: change the YAML, then run `npm run render`. -->';

export function renderDocs(contract) {
  const lines = [
    NOTICE,
    '',
    '# Quy trình SDLC',
    '',
    'Bản đọc của hợp đồng trong `contract/`. Nội dung và lý do của từng quyết định nằm ở [SPEC-sdlc-contract.md](../SPEC-sdlc-contract.md).',
    '',
    ...roles(contract),
    ...stagesAndGates(contract),
    ...workItems(contract),
    ...workflows(contract),
    ...readyAndDone(contract),
    ...branchesAndRouting(contract),
    ...cadenceAndMetrics(contract),
    ...errorHandling(contract),
    ...artifacts(contract),
  ];
  return `${lines.join('\n').trimEnd()}\n`;
}

function roles({ roles }) {
  return [
    '## Vai trò',
    '',
    ...table(['Role id', 'Vai trò', 'Việc chính'], roles.map(({ id, name, responsibilities }) => [code(id), name, responsibilities])),
    '',
  ];
}

function stagesAndGates(contract) {
  const artifactName = Object.fromEntries(contract.artifacts.map(({ id, name }) => [id, name]));
  const gateById = Object.fromEntries(contract.gates.map((gate) => [gate.id, gate]));
  const stages = contract.stages.map(({ id, name, roles, lead, note, input, guards = [], outputs, exit, gate }) => [
    code(id),
    name,
    [roles.map((role) => (role === lead ? `${code(role)} (chính)` : code(role))).join(', '), note].filter(Boolean).join('; '),
    guards.length > 0 ? `${input}. Guard: ${list(guards)}` : input,
    [...(outputs.artifacts ?? []).map((artifact) => `${artifactName[artifact]} (${code(artifact)})`), outputs.other].filter(Boolean).join('; '),
    [exit, gate && `Cổng ${circled(gateById[gate].number)} ${code(gate)}: ${gateById[gate].description}`].filter(Boolean).join('; '),
  ]);
  const gates = contract.gates.map(({ id, number, approvers, description }) => [
    circled(number),
    code(id),
    list(contract.stages.filter((stage) => stage.gate === id).map((stage) => stage.id)),
    list(approvers),
    description,
  ]);
  return [
    '## Giai đoạn và cổng',
    '',
    ...table(['Stage id', 'Giai đoạn', 'Người làm', 'Đầu vào', 'Đầu ra', 'Điều kiện để qua'], stages),
    '',
    '### Cổng duyệt',
    '',
    ...table(['Cổng', 'Gate id', 'Giai đoạn', 'Người duyệt', 'Nội dung'], gates),
    '',
  ];
}

function workItems(contract) {
  const workflowOf = (type) => Object.keys(contract.workflows).find((name) => contract.workflows[name].applies_to.includes(type));
  const hierarchy = [
    ...contract.work_item_groupings.map(({ concept, jira, note }) => [concept, jira, '', '', note]),
    ...contract.work_types.map(({ id, concept, jira_issue_type: jira, note }) => [concept, jira, code(id), code(workflowOf(id)), note]),
  ];
  const fields = contract.work_item_fields.map(({ name, applies_to: types, value, values, filled_by: filledBy, note }) => [
    name,
    list(types),
    [value ?? valueList(values), note].filter(Boolean).join('. '),
    filledBy,
  ]);
  return [
    '## Work item',
    '',
    '### Phân cấp',
    '',
    ...table(['Mô hình khái niệm', 'Trong Jira', 'Work type', 'Workflow', 'Ghi chú'], hierarchy),
    '',
    `**Cách chọn loại:** ${contract.work_type_selection}`,
    '',
    '### Quy ước',
    '',
    ...contract.work_item_conventions.map((convention) => `- ${convention}`),
    '',
    '### Trường dữ liệu',
    '',
    ...table(['Trường', 'Áp dụng', 'Giá trị', 'Ai điền'], fields),
    '',
  ];
}

// Values with a description read as "Name: description; ...", plain values as "A, B, C".
function valueList(values) {
  const described = values.some(({ description }) => description);
  return values.map(({ name, description }) => (description ? `${name}: ${description}` : name)).join(described ? '; ' : ', ');
}

function readyAndDone(contract) {
  const rows = (key) => contract.work_types.filter((type) => type[key]).map((type) => [code(type.id), type[key].join('; ')]);
  return [
    '## DoR và DoD',
    '',
    '### DoR',
    '',
    'Điều kiện để item vào `ready`.',
    '',
    ...table(['Loại', 'DoR'], rows('dor')),
    '',
    '### DoD',
    '',
    `Điều kiện để item vào \`done\`. Phần chung cho ${list(contract.dod_common.applies_to)}:`,
    '',
    ...contract.dod_common.criteria.map((criterion) => `- ${criterion}`),
    '',
    'Phần riêng của từng loại, cộng thêm phần chung nếu loại đó có trong danh sách trên:',
    '',
    ...table(['Loại', 'DoD'], rows('dod')),
    '',
  ];
}

function branchesAndRouting(contract) {
  const { new_work_route: newWork, fix_versions: fixVersions, versioning } = contract;
  const routes = contract.bug_routing.flatMap(({ name, routes }) =>
    routes.map(({ severities, fix_version: fixVersion, base_branch: base, qa_environments: qa, note = '' }) => [
      name,
      list(severities),
      `${fixVersions[fixVersion]} (${code(fixVersion)})`,
      code(base),
      list(qa),
      note,
    ]),
  );
  const environments = contract.environments.map(({ name, branches, tagged, deploy, data }) => [
    name,
    `${list(branches)}${tagged ? ' + tag' : ''}`,
    deploy,
    data,
  ]);
  return [
    '## Môi trường, nhánh và định tuyến bug',
    '',
    ...table(['Môi trường', 'Nhận code từ', 'Khi nào deploy', 'Dữ liệu'], environments),
    '',
    `**Việc mới** (${list(newWork.applies_to)}) tách nhánh từ ${code(newWork.base_branch)} và được QA trên ${list(newWork.qa_environments)}.`,
    '',
    '### Định tuyến bug',
    '',
    'Theo vị trí của bản cũ nhất đang có lỗi, và Severity:',
    '',
    ...table(['Bản cũ nhất đang có lỗi', 'Severity', 'Fix Version', 'Nhánh gốc', 'QA trên', 'Ghi chú'], routes),
    '',
    ...contract.bug_rules.map((rule) => `- ${rule}`),
    '',
    '### Đánh số phiên bản',
    '',
    `Theo ${versioning.scheme}:`,
    '',
    ...versioning.bumps.map(({ part, when, example }) => `- ${when}: tăng ${code(part)}${example ? ` (${example})` : ''}`),
    '',
  ];
}

function cadenceAndMetrics(contract) {
  const gateNumber = Object.fromEntries(contract.gates.map(({ id, number }) => [id, number]));
  const schedule = contract.cadence.schedule.map(({ when, what, gates = [] }) => [
    when,
    gates.length > 0 ? `${what} (cổng ${gates.map((gate) => circled(gateNumber[gate])).join(' ')})` : what,
  ]);
  return [
    '## Nhịp làm việc, release, WIP và số liệu',
    '',
    contract.cadence.method,
    '',
    ...table(['Thời điểm', 'Việc'], schedule),
    '',
    '### Release',
    '',
    ...contract.release_rules.map(({ title, text }) => `- **${title}.** ${text}`),
    '',
    '### Giới hạn WIP',
    '',
    'Giới hạn mặc định, chỉnh được ở retro:',
    '',
    ...table(['Chỗ', 'Giới hạn'], contract.wip_limits.map(({ scope, limit }) => [scope, String(limit)])),
    '',
    '### Số liệu cho retro',
    '',
    ...table(['Số liệu', 'Cách tính'], contract.metrics.map(({ name, definition }) => [name, definition])),
    '',
  ];
}

function errorHandling({ rework, retry, error_handling: situations }) {
  return [
    '## Xử lý lỗi',
    '',
    `- Rework count chạm \`${rework.limit}\` thì thêm effect ${code(rework.on_limit)}.`,
    `- CI fail nghi do test chập chờn được chạy lại tối đa \`${retry.flaky_ci_reruns}\` lần.`,
    `- Agent dừng sau \`${retry.agent_failures_before_stop}\` lần thất bại liên tiếp ở cùng một bước.`,
    '',
    ...table(['Tình huống', 'Xử lý'], situations.map(({ situation, action }) => [situation, action])),
    '',
  ];
}

const CREATORS = { reporter: 'Người báo lỗi', assignee: 'Agent đang làm item' };
const PLACES = { git: 'Git', tracker: 'Jira', 'github-pr': 'GitHub', local: 'Local', 'google-drive': 'Google Drive' };
const LANGUAGES = { en: 'Tiếng Anh', vi: 'Tiếng Việt' };

function artifacts(contract) {
  const rows = contract.artifacts.map(({ name, template, created_by: createdBy, stored_in: storedIn }) => [
    name,
    code(template),
    Array.isArray(createdBy) ? list(createdBy) : CREATORS[createdBy],
    storedIn.map(({ place, path, note }) => `${PLACES[place]}: ${[path && code(path), note].filter(Boolean).join(', ')}`).join('; '),
  ]);
  return [
    '## Artifact và template',
    '',
    ...table(['Artifact', 'Template', 'Ai tạo', 'Lưu ở đâu'], rows),
    '',
    ...contract.artifact_notes.map((note) => `- ${note}`),
    '',
    '### Ngôn ngữ',
    '',
    ...table(['Nội dung', 'Ngôn ngữ'], contract.language.map(({ what, language }) => [what, LANGUAGES[language]])),
    '',
  ];
}

function workflows(contract) {
  const lines = ['## Workflow', ''];
  for (const [name, workflow] of Object.entries(contract.workflows)) {
    lines.push(
      `### ${code(name)}`,
      '',
      `Áp dụng cho ${list(workflow.applies_to)}. Bắt đầu ở ${code(workflow.initial)}, kết thúc ở ${list(workflow.final)}.`,
      '',
      ...diagram(workflow),
      '',
    );
    const states = Object.entries(workflow.states);
    if (states.some(([, state]) => state.description || state.board_column)) {
      const rows = states.map(([id, { description = '', board_column: column }]) => [code(id), description, column ? code(column) : '']);
      lines.push(...table(['State', 'Nghĩa', 'Cột trên board'], rows), '');
    }
    const rows = workflow.transitions.map((transition) => transitionRow(contract, transition));
    lines.push(...table(['Transition', 'Từ → đến', 'Ai chuyển', 'Điều kiện', 'Bằng chứng', 'Effect'], rows), '');
  }
  return lines;
}

// Mermaid ids cannot contain "-", so every state gets an alias.
function diagram({ initial, final, states, transitions }) {
  const node = (state) => state.replaceAll('-', '_');
  return [
    '```mermaid',
    'stateDiagram-v2',
    ...Object.keys(states).map((state) => `    state "${state}" as ${node(state)}`),
    `    [*] --> ${node(initial)}`,
    ...transitions.flatMap(({ id, from, to }) => [from].flat().map((source) => `    ${node(source)} --> ${node(to)}: ${id}`)),
    ...final.map((state) => `    ${node(state)} --> [*]`),
    '```',
  ];
}

function transitionRow(contract, { id, from, to, actors, guards = [], effects = [], note }) {
  const declared = guards.map((guard) => contract.guards[guard]);
  const evidence = new Set(declared.map(({ evidence: { source, artifact } }) => (artifact ? `${code(source)} (${code(artifact)})` : code(source))));
  return [
    code(id),
    `${list([from].flat())} → ${code(to)}`,
    note ? `${list(actors)}: ${note}` : list(actors),
    declared.map(({ description }) => description).join('; ') || 'Không có',
    [...evidence].join(', ') || 'Không có',
    list(effects),
  ];
}

function table(header, rows) {
  return [header, header.map(() => '---'), ...rows].map((cells) => `| ${cells.map((cell) => cell.replaceAll('|', '\\|')).join(' | ')} |`);
}

// 1 → ①, the gate numbering of the spec.
function circled(number) {
  return String.fromCharCode(0x2460 + number - 1);
}

function list(ids) {
  return ids.map(code).join(', ');
}

function code(id) {
  return `\`${id}\``;
}
