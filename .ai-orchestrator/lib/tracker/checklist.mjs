// Renders docs/jira-setup.md, the step-by-step checklist for building Jira by hand from the contract and
// tracker/jira.yaml (tracker-integration spec section 2.10). Each section says where to click, then lists the items
// to create. Deterministic, in YAML order, LF line endings, like lib/render.mjs.

import { expectedBoard, expectedOptions, expectedResolutions, expectedWorkflows } from './expected.mjs';

const NOTICE =
  '<!-- Generated from contract/ and tracker/jira.yaml by scripts/jira-checklist.mjs. Do not edit by hand: change the YAML, then run `npm run jira:checklist`. -->';

const CATEGORIES = { 'to-do': 'To Do', 'in-progress': 'In Progress', done: 'Done' };
// Environment types of the Jira Deployments panel, in the order Jira lists them.
const JIRA_ENVIRONMENT_TYPES = ['development', 'testing', 'staging', 'production', 'unmapped'];
// The first steps of every Jira admin page: the gear at the top right, then the Work items settings.
const WORK_ITEM_SETTINGS = 'Trên Jira, bấm biểu tượng bánh răng ⚙ ở góc trên bên phải. Trong **Jira admin settings**, ô **Switch settings** chọn **Work items**';
// Contract work types that Jira places outside the story level: Epic exists on every site, sub-task types sit below.
const BUILT_IN_TYPES = ['epic'];
const SUB_TASK_TYPES = ['sub-task'];

export function renderChecklist(contract, mapping) {
  const sections = [
    ['Group và service account', groups(mapping)],
    ['Rovo MCP', rovo()],
    ['Resolution', resolutions(contract, mapping)],
    ['Status', statuses(mapping)],
    ['Workflow', workflows(contract, mapping)],
    ['Work type', workTypes(contract)],
    ['Workflow scheme', workflowScheme(contract, mapping)],
    ['Trường', fields(contract, mapping)],
    ['Space', space(contract, mapping)],
    ['Board', board(contract, mapping)],
    ['GitHub for Jira', github()],
    ['Môi trường', environments(mapping)],
    ['Kiểm lại', ['- [ ] Chạy `npm run jira:check -- --space <KEY>` trong repo kit: lệnh không báo chỗ lệch nào']],
  ];
  const lines = [
    NOTICE,
    '',
    '# Dựng Jira cho một dự án',
    '',
    'Checklist dựng tay theo hợp đồng trong `contract/` và ánh xạ `tracker/jira.yaml`, cho gói Jira Free. Làm theo thứ tự, vì mục sau dùng thứ mục trước tạo ra; mỗi dự án chỉ dựng một lần. Lý do của từng mục nằm ở [SPEC-tracker-integration.md](../SPEC-tracker-integration.md), mục 2.',
    '',
    'Mỗi mục có phần **Cách làm** (bấm vào đâu) và danh sách `- [ ]` (tạo những gì). Tên nút lấy từ tài liệu của Atlassian; giao diện thật có thể khác một chút. Chỗ nào ghi "đối chiếu giao diện" là tài liệu không nêu tên nút: nếu không thấy, chụp màn hình rồi hỏi.',
    ...sections.flatMap(([title, body], index) => ['', `## ${index + 1}. ${title}`, '', ...body]),
  ];
  return `${lines.join('\n')}\n`;
}

// .jira/config.yml for the GitHub for Jira app: the GitHub environments of each Jira environment type (spec 2.9).
export function renderJiraConfig(mapping) {
  const byType = Object.groupBy(Object.values(mapping.environments), ({ jira_type: type }) => type);
  const rows = JIRA_ENVIRONMENT_TYPES.filter((type) => byType[type]).map(
    (type) => `    ${type}: [${byType[type].map(({ github_environment: env }) => JSON.stringify(env)).join(', ')}]`,
  );
  return ['deployments:', '  environmentMapping:', ...rows, ''].join('\n');
}

function groups({ identities }) {
  const users = identities.filter(({ kind }) => kind === 'user');
  const services = identities.filter(({ kind }) => kind === 'service-account');
  return [
    '**Cách tạo group:**',
    '',
    '1. Mở admin.atlassian.com, chọn tổ chức của bạn.',
    '2. Menu bên trái: **Directory** → **Groups** → **Create group**.',
    '3. Gõ tên group, bấm **Create**.',
    '',
    ...identities.map(({ id, group }) => `- [ ] Tạo group ${code(group)} (danh tính ${code(id)})`),
    '',
    '**Cách thêm tài khoản của bạn vào group:**',
    '',
    '1. **Directory** → **Groups** → bấm vào tên group.',
    '2. Bấm **Add users**, gõ tên hoặc email của bạn, chọn tài khoản, bấm **Add**.',
    '',
    ...users.map(({ group, account, roles }) => `- [ ] Group ${code(group)}: thêm tài khoản admin của bạn (\`${account}\`), vai trò ${list(roles)}`),
    '',
    '**Cách thêm service account vào group** (ô tìm trong trang group chỉ lọc người đã có trong group, nên không dùng được):',
    '',
    '1. **Directory** → **Service accounts** → bấm vào tên service account.',
    '2. Bấm **•••** ở góc trên bên phải → **Add to group**.',
    '3. Chọn group, xác nhận.',
    '',
    ...services.map(({ group, account, roles }) => `- [ ] Group ${code(group)}: thêm service account \`${account}\`, vai trò ${list(roles)}`),
    '',
    '**Kiểm lại:** mở từng group, tài khoản phải hiện ở tab **Members** hoặc **Agents**.',
    '',
    ...services.map(
      ({ account, token_env: env, token_expires_on: date }) =>
        `- [ ] Token của \`${account}\` hết hạn ${date}, nằm trong biến môi trường \`${env}\`, không nằm trong file nào`,
    ),
  ];
}

function rovo() {
  return [
    '**Cách làm:** admin.atlassian.com → menu bên trái **Connectors** → **Atlassian MCP server** → mục **Authentication** → bật **API token**.',
    '',
    '- [ ] API token cho Rovo MCP đã bật',
  ];
}

function resolutions(contract, mapping) {
  return [
    'Resolution làm trước workflow, vì transition `Cancel` hỏi Resolution và các transition vào Done đặt Resolution.',
    '',
    '**Cách làm:**',
    '',
    `1. ${WORK_ITEM_SETTINGS}.`,
    '2. Menu bên trái, kéo xuống, chọn **Resolutions**.',
    '3. Xem danh sách: tên nào bên dưới đã có (đúng chữ hoa, chữ thường) thì đánh dấu là xong.',
    '4. Tên nào chưa có: bấm **Add resolution**, gõ tên, bấm **Add**.',
    '',
    'Nếu danh sách có hai resolution `Done` cùng mô tả "GreenHopper Managed Resolution", giữ nguyên cả hai, đừng xóa: Jira Software tự tạo chúng, xóa đi có thể làm hỏng transition của space khác, và Jira có thể tạo lại. Khi một rule ở mục 5 cần chọn `Done`, chọn cái đứng đầu danh sách.',
    '',
    ...expectedResolutions(contract, mapping).map((name) => `- [ ] Resolution ${code(name)}`),
  ];
}

function statuses(mapping) {
  const seen = new Map();
  for (const { states } of Object.values(mapping.workflows)) {
    for (const { status, category } of Object.values(states)) if (!seen.has(status)) seen.set(status, category);
  }
  return [
    '**Cách làm:**',
    '',
    `1. ${WORK_ITEM_SETTINGS}.`,
    '2. Menu bên trái, chọn **Statuses**.',
    '3. Với từng dòng bên dưới, xem danh sách status có sẵn trước. Nếu đã có status cùng tên và cột **Category** trùng thì dùng lại, đánh dấu là xong.',
    '4. Nếu chưa có: bấm **Add status**. Ô **Name** gõ tên, ô **Category** chọn như bên dưới, bấm **Add**.',
    '',
    ...[...seen].map(([status, category]) => `- [ ] Name ${code(status)}, Category ${code(CATEGORIES[category])}`),
  ];
}

function workflows(contract, mapping) {
  return [
    '**Cách mở trình sửa workflow:**',
    '',
    `1. ${WORK_ITEM_SETTINGS}.`,
    '2. Menu bên trái: **Workflows**.',
    '3. Tạo workflow mới: bấm nút tạo workflow ở góc trên bên phải (đối chiếu giao diện: có thể tên là **Create workflow** hoặc **Add workflow**), gõ tên workflow.',
    '4. Sửa workflow đã có: tìm tên workflow → **•••** → **Edit**.',
    '',
    '**Cách thêm status vào workflow:** bấm **Add status** → tìm status đã tạo ở mục 4 → **Add**. Ở khung chi tiết bên phải, **không** tick ô "Allow all statuses to transition to this one".',
    '',
    '**Cách thêm transition:** bấm **Add transition** ở đầu trang → chọn **From status** và **To status** → gõ tên transition → **Add**.',
    '',
    '**Cách giới hạn ai được chuyển (rule Restrict):**',
    '',
    '1. Bấm vào nhãn của transition trên sơ đồ. Khung **Transition** hiện ở bên phải.',
    '2. Trong khung đó, phần **Rules** có bốn nhóm: Restrict transition, Request input, Validate details, Perform actions. Ở nhóm **Restrict transition**, bấm **Add restrict transition rule** (hoặc dấu **+**).',
    '3. Hộp **Add rule** mở ra. Kéo danh sách bên phải xuống cuối, chọn **Restrict who can move a work item** → **Select**.',
    '4. Ô **Restrict to** chọn **Groups** → chọn các group ghi ở dòng đó → **Add**.',
    '',
    '**Rule đặt Resolution là Done:** trong khung **Transition**, nhóm **Perform actions** → **Add perform actions rule** → **Update an issue field** (có thể tên **Update a work item field**) → **Select** → ô **Update this field** chọn **Resolution** → giá trị **Done** → **Add**.',
    '',
    '**Rule hỏi Resolution khi hủy:** làm cho **từng** transition có ghi "Rule hỏi Resolution khi hủy", vì mỗi transition giữ rule riêng. Thiếu rule thì Jira hủy item mà không hỏi gì, và Resolution để trống.',
    '',
    '1. Trước tiên kiểm màn hình: **Jira admin settings** → **Work items** → **Screens** → tìm `Resolve Issue Screen` (màn hình có sẵn của Jira) → bấm vào, xem có trường **Resolution**. Không có màn hình này thì chụp danh sách rồi hỏi.',
    '2. Trong trình sửa workflow, bấm nhãn transition → khung **Transition** → nhóm **Request input** → nút thêm rule của nhóm (đối chiếu giao diện: giống **Add restrict transition rule** của nhóm Restrict) → chọn **Show a screen**.',
    '3. Ô **Select a screen** chọn `Resolve Issue Screen` → **Add**.',
    '',
    '**Kiểm trước khi lưu:** tick ô **Show transition labels** để sơ đồ hiện tên mọi transition. Bấm lần lượt từng transition và xem khung **Rules**: nhóm **Restrict transition** phải có rule, và transition nào có ghi Resolution thì nhóm tương ứng phải có rule. Nhóm chưa có rule chỉ hiện nút **Add … rule**.',
    '',
    '**Cuối cùng:** bấm **Update workflow** (hoặc nút lưu tương ứng) để lưu.',
    '',
    'Lưu ý:',
    '',
    '- Workflow mới có thể có sẵn vài status hoặc transition mẫu. Xóa mọi status và transition không có trong danh sách bên dưới.',
    '- Mũi tên **Create** (item mới tạo) phải đi vào status đầu ghi ở dòng "Tạo workflow".',
    '- Không có transition nào từ "Any status": item đã Done hoặc Cancelled không được chuyển đi đâu nữa.',
    '- Nếu không tìm thấy rule **Restrict who can move a work item** (gói Free có thể không có), bỏ phần group, chụp màn hình danh sách rule rồi báo lại. Khi đó hook trong Claude Code là lớp chặn duy nhất với agent.',
    ...expectedWorkflows(contract, mapping).flatMap(({ id, name, initial, statuses, transitions }) => {
      const types = contract.workflows[id].applies_to.map((type) => jiraType(contract, type)).join(', ');
      return [
        '',
        `### ${code(name)} (${types})`,
        '',
        `- [ ] Tạo workflow ${code(name)}, status đầu là ${code(initial)}`,
        `- [ ] Thêm status: ${statuses.map(({ name: status }) => code(status)).join(', ')}`,
        ...transitions.map(({ name: label, from, to, groups, setResolution, asksResolution }) =>
          [
            `- [ ] Transition ${code(label)}: From ${code(from)}, To ${code(to)}`,
            `Restrict → Groups: ${groups.map(code).join(', ')}`,
            setResolution && `Rule đặt Resolution là ${code(setResolution)}`,
            asksResolution && 'Rule hỏi Resolution khi hủy',
          ]
            .filter(Boolean)
            .join('. '),
        ),
        '- [ ] Bấm **Update workflow** để lưu',
      ];
    }),
  ];
}

function workTypes(contract) {
  return [
    'Workflow scheme chỉ gắn được work type đã có trên site, nên tạo đủ work type trước.',
    '',
    '**Cách làm:**',
    '',
    `1. ${WORK_ITEM_SETTINGS}.`,
    '2. Menu bên trái, chọn **Work types**. Với từng dòng bên dưới, xem danh sách trước: đã có work type đúng tên thì dùng lại, đánh dấu là xong.',
    '3. Loại Standard còn thiếu: bấm **Add work type** → ô **Name** gõ tên → nếu hộp có ô chọn loại thì chọn loại Standard (đối chiếu giao diện) → không chọn work type scheme → **Add**.',
    '4. Loại sub-task còn thiếu: menu bên trái chọn **Sub-tasks** → **Add subtask work type** (đối chiếu giao diện) → ô **Name** gõ tên → **Add**. Nếu trang báo sub-task đang tắt, bấm **Enable** trước.',
    '5. Tên phải đúng từng chữ như dòng bên dưới, kể cả dấu gạch nối.',
    '',
    ...contract.work_types.map(({ id, jira_issue_type: type }) => {
      if (BUILT_IN_TYPES.includes(id)) return `- [ ] Work type ${code(type)}: có sẵn trong Jira, không tạo`;
      if (SUB_TASK_TYPES.includes(id)) return `- [ ] Work type ${code(type)}, loại sub-task (trang **Sub-tasks**)`;
      return `- [ ] Work type ${code(type)}, loại Standard`;
    }),
  ];
}

function workflowScheme(contract, mapping) {
  const workflowOf = (type) => Object.keys(contract.workflows).find((name) => contract.workflows[name].applies_to.includes(type));
  const byWorkflow = Object.groupBy(contract.work_types, ({ id }) => workflowOf(id));
  return [
    '**Cách làm:**',
    '',
    `1. ${WORK_ITEM_SETTINGS}.`,
    '2. Menu bên trái: **Workflow schemes** → **Add workflow scheme**.',
    `3. Ô name gõ ${code(mapping.workflow_scheme)} → **Add**.`,
    '4. Với từng workflow bên dưới: bấm **Add Workflow** → **Add Existing** → chọn workflow → **Next** → hộp **Assign Issue Types** hiện ra, tick các work type ghi ở dòng đó → **Finish**. Nếu hộp thiếu work type nào, quay lại mục 6.',
    '5. Không tick ô **All Unassigned Issue Types**. Dòng workflow mặc định `Jira Workflow (jira)` của scheme để nguyên.',
    '',
    `- [ ] Tạo workflow scheme ${code(mapping.workflow_scheme)}`,
    ...Object.entries(byWorkflow).map(
      ([name, types]) => `- [ ] Workflow ${code(mapping.workflows[name].jira_workflow)}: ${types.map(({ jira_issue_type: type }) => code(type)).join(', ')}`,
    ),
  ];
}

function fields(contract, mapping) {
  const rows = contract.work_item_fields.flatMap(({ id, name, applies_to: types }) => {
    const field = mapping.fields[id];
    const forTypes = types.map((type) => jiraType(contract, type)).join(', ');
    if (field.type === 'select') {
      const options = expectedOptions(contract, mapping, id).map(code).join(', ');
      return [`- [ ] Field ${code(field.jira_field)}, type Select List (single choice), dùng cho ${forTypes}. Option: ${options}`];
    }
    if (field.type === 'builtin' && id !== 'resolution') return [`- [ ] ${code(field.jira_field)}: trường có sẵn, không tạo; dùng cho ${forTypes}`];
    if (field.derived_from) return [`- [ ] ${name}: không tạo trường, số này được đếm từ lịch sử chuyển trạng thái`];
    return [];
  });
  return [
    '**Cách tạo một custom field:**',
    '',
    `1. ${WORK_ITEM_SETTINGS}.`,
    '2. Menu bên trái: **Fields** → nút tạo field (đối chiếu giao diện: **Create new field** hoặc **Create custom field**).',
    '3. Chọn loại **Select List (single choice)** → gõ tên field → thêm từng option theo đúng thứ tự bên dưới → tạo field.',
    '4. Nếu Jira hỏi gắn field vào màn hình (screen) nào, bỏ qua: mục 9 gắn field vào màn hình của space.',
    '5. Không giới hạn work type cho field: Jira không cho sửa work type của context mặc định (Global context, ô **Any issue type**), và cũng không cần **Add new context**. Work type ghi sau "dùng cho" là nơi hợp đồng dùng field đó; mục 9 chỉ đưa field lên screen của các work type này.',
    '',
    ...rows,
  ];
}

function space(contract, mapping) {
  // Field contexts can no longer be limited to work types, so the screens decide where a field shows.
  const onScreens = contract.work_item_fields
    .filter(({ id }) => mapping.fields[id].type && id !== 'resolution')
    .map(({ id, applies_to: types }) => `- [ ] ${code(mapping.fields[id].jira_field)}: screen của ${types.map((type) => jiraType(contract, type)).join(', ')}`);
  return [
    '**Tạo space:**',
    '',
    '1. Thanh trên cùng của Jira: **Spaces** → **Create space**.',
    '2. Chọn template **Kanban** → **Use template**.',
    '3. Chọn loại **Company-managed** (không chọn Team-managed).',
    '4. Bước **Name your space**: ô **Name** gõ tên dự án, ô **Key** gõ key của dự án (pilot: `DEMO`) → **Next**.',
    "5. Bước **Let's set up your space**: phần **Work types** giữ các loại có sẵn; nếu **Add work type** cho chọn `Sub-task` thì thêm, không có thì bỏ qua (bước Work type bên dưới thêm sau). Phần **Statuses** để nguyên: bước Workflow scheme bên dưới thay toàn bộ → **Next**.",
    '6. Bước cuối: làm theo màn hình để tạo space (đối chiếu giao diện).',
    '',
    '- [ ] Space company-managed, template Kanban, key của dự án (pilot: `DEMO`)',
    '',
    '**Mở Space settings:** trong space, menu bên trái, bấm **•••** cạnh tên space → **Space settings**.',
    '',
    '**Work type:** Space settings → menu bên trái **Work items** → **Types**. Danh sách phải có đủ các loại bên dưới. Thiếu loại nào: bấm **Actions** → **Edit work types** (đối chiếu giao diện), kéo loại còn thiếu vào cột của scheme → **Save**. Trình tạo space không có sẵn loại sub-task, nên `Sub-task` thường phải thêm ở đây. Nếu danh sách có loại lạ, ví dụ `Subtask` không gạch nối, đừng xóa; chụp màn hình rồi hỏi.',
    '',
    `- [ ] Space có đủ work type: ${contract.work_types.map(({ jira_issue_type: type }) => code(type)).join(', ')}`,
    '',
    `**Workflow scheme:** Space settings → **Workflows** → **Switch scheme** → chọn ${code(mapping.workflow_scheme)} → **Associate** → chờ Jira chuyển xong → **Acknowledge**.`,
    '',
    `- [ ] Space dùng workflow scheme ${code(mapping.workflow_scheme)}`,
    '',
    '**Màn hình:** Space settings → menu bên trái **Work items** → **Screens**. Trang này chia theo screen scheme; mỗi scheme ghi work type nào dùng nó và cột **Screen** ghi tên screen (thường một screen dùng cho cả Create, Edit, View). Field chỉ hiện ở work type có field đó trên screen.',
    '',
    '1. Với từng dòng bên dưới, tìm screen của từng work type ghi ở dòng đó. Nhiều work type dùng chung một screen thì chỉ thêm một lần.',
    '2. Bấm tên screen (chữ xanh ở cột **Screen**) → trang cấu hình screen mở ra.',
    '3. Tìm ô thêm field (đối chiếu giao diện: ô **Select Field...** ở cuối danh sách, hoặc nút **Add field**) → gõ tên field → chọn. Field đã có trên screen thì bỏ qua.',
    '',
    ...onScreens,
  ];
}

function board(contract, mapping) {
  const { columns: [backlog, ...columns], unplaced } = expectedBoard(contract, mapping);
  return [
    'Template Kanban đã tạo sẵn một board cho space; mục này sửa board đó.',
    '',
    '**Mở Board settings:** trong space, mở board → bấm **•••** cạnh tên board → **Board settings**.',
    '',
    '**Filter:** filter của board được sửa ở trang filter, không sửa ngay trong Board settings.',
    '',
    '1. Board settings → **Details** → phần **Board filter** → bấm **Edit filter query**. Trang filter mở ở tab mới.',
    '2. Ô JQL: xóa câu cũ, dán dòng bên dưới (thay `<KEY>` bằng key của space).',
    '3. Bấm Enter, hoặc biểu tượng kính lúp ở cuối ô JQL, để chạy câu mới. Chưa chạy thì Jira lưu lại câu cũ.',
    '4. Bấm nút lưu hiện ra cạnh tên filter (đối chiếu giao diện: **Save filter** hoặc **Save changes**).',
    '5. Quay lại tab Board settings, tải lại trang (F5): ô **Filter query** phải hiện câu mới. **Board sub-filter** để nguyên.',
    '',
    `- [ ] Filter: ${code(mapping.board.filter.replaceAll('{key}', '<KEY>'))}`,
    '',
    '**Cột:** Board settings → **Columns** (nếu menu thu gọn, bấm **Layout** để mở thêm).',
    '',
    'Board mới không có mục **Columns** trong Board settings; trang **Details** của nó ghi "This space uses the modern Jira board". Với board này: trên trang board, bấm **More actions** (•••) → **Configure columns** (đối chiếu giao diện). Trong hộp đó, ô **Backlog** là Kanban backlog, ô **Hidden statuses** là Unmapped statuses, và số tối đa đặt ở biểu tượng cạnh tên cột. Sửa xong thì bấm **Publish**. Sau khi đổi workflow scheme, trang board có thể ẩn các cột của template, vì chúng chỉ còn status cũ; hộp **Configure columns** vẫn hiện đủ. Bấm **Publish** xong, chạy `jira:check` ở bước Kiểm lại: ở Pilot 1, lần Publish đầu để `New` nằm nhầm trong cột `In Review`.',
    '',
    '1. Sửa danh sách cột cho đúng tên và thứ tự bên dưới: đổi tên cột có sẵn, thêm cột bằng nút **+** bên phải các cột, xóa cột thừa.',
    `2. Kéo status ${backlog.statuses.map(code).join(', ')} vào ô **Kanban backlog** (đây là cột ${code(backlog.name)}). Item ở đây không hiện trên board; xem chúng ở tab **List** của space.`,
    '3. Kéo từng status còn lại vào đúng cột ghi bên dưới. Status không dùng để lại ở ô **Unmapped statuses**.',
    '4. Phần **Column constraints** chọn **Work item count**, rồi gõ số tối đa dưới tên cột có ghi "Tối đa".',
    '',
    `- [ ] Kanban backlog (${code(backlog.name)}): status ${backlog.statuses.map(code).join(', ')}`,
    ...columns.map(({ name, statuses, max }) => `- [ ] Cột ${code(name)}: status ${statuses.map(code).join(', ')}${max ? `. Tối đa ${max}` : ''}`),
    ...unplaced.map((status) => `- [ ] Status ${code(status)} để ở Unmapped statuses, để item rời khỏi board`),
  ];
}

function github() {
  return [
    '**Cách làm** (đối chiếu giao diện ở bước 5):',
    '',
    '1. Thanh bên trái của Jira: **Apps** → **Explore more apps** → ô tìm gõ `GitHub for Atlassian` (tên mới của GitHub for Jira) → chọn app **GitHub for Atlassian** của nhà phát hành **Atlassian**, không chọn các app GitHub của hãng khác → **Get app**.',
    '2. Cài xong, Jira mở trang **Connect GitHub to Atlassian** (nếu không, vào **Jira admin settings** → **Marketplace apps** → **GitHub for Atlassian**). Chọn **GitHub Cloud** → **Next**.',
    '3. Nếu được hỏi thì đăng nhập GitHub. Dòng **Logged in as** phải là tài khoản sở hữu repo của dự án.',
    '4. Bấm **Select an organization in GitHub**: GitHub mở ở tab mới. Nếu bấm mà không có gì xảy ra, trình duyệt đã chặn pop-up: bấm biểu tượng chặn pop-up ở cuối thanh địa chỉ → cho phép pop-up từ site Jira → bấm lại.',
    '5. Trên GitHub: chọn tài khoản sở hữu repo → **Only select repositories** → chọn repo của dự án → **Install** → quay lại tab Jira, bấm **Connect** cạnh tài khoản nếu có. Trang ghi "organization" nhưng tài khoản GitHub cá nhân cũng dùng được (đã nối thử ở pilot).',
    '6. Kiểm: trang **GitHub configuration** → **Connections** có tài khoản, **Repository access** là **Only select repos**, **Backfill status** là **FINISHED**.',
    '',
    '- [ ] App GitHub for Atlassian đã cài và nối với repo của dự án (pilot: `TungPH7/ao-pilot`)',
  ];
}

function environments(mapping) {
  return [
    '**Cách làm:** repo dự án trên GitHub → **Settings** → **Environments** → **New environment** → gõ tên → **Configure environment**.',
    '',
    ...Object.values(mapping.environments).map(({ github_environment: env }) => `- [ ] GitHub environment ${code(env)}`),
    '- [ ] File `.jira/config.yml` trên nhánh mặc định của repo dự án, với nội dung:',
    '',
    '```yaml',
    renderJiraConfig(mapping).trimEnd(),
    '```',
    '',
    '- [ ] Nếu app GitHub for Jira được nối trước khi có file này: ngắt rồi nối lại kết nối GitHub trong app',
  ];
}

function jiraType(contract, workType) {
  return code(contract.work_types.find(({ id }) => id === workType).jira_issue_type);
}

function list(ids) {
  return ids.map(code).join(', ');
}

function code(text) {
  return `\`${text}\``;
}
