import { test, expect, type APIRequestContext } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function create(request: APIRequestContext, collection: string, payload: Record<string, any>) {
  const response = await request.post(`/api/collections/${collection}`, { data: payload });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data;
}

test("opens locally, uses no external runtime resources, and reaches all nine pages", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) externalRequests.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /从重点开始/ })).toBeVisible();
  const destinations = [
    ["首页总览", /从重点开始/], ["今日计划", "今日计划"], ["自媒体", "自媒体"], ["开发工作", "开发工作"],
    ["咨询工作", "咨询工作"], ["健身计划", "健身计划"], ["饮食计划", "饮食计划"], ["游戏娱乐", "游戏娱乐"], ["数据与设置", "数据与设置"],
  ] as const;
  for (const [link, heading] of destinations) {
    await page.getByRole("link", { name: link }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
  await page.getByRole("link", { name: "首页总览" }).click();
  await page.locator(".summary-tile").filter({ hasText: "自媒体" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "自媒体" })).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test("creates, schedules, displays and completes a daily plan item", async ({ page }) => {
  await page.goto("/today");
  await page.locator("header").getByRole("button", { name: "添加事项" }).click();
  await page.getByLabel(/事项名称/).fill("浏览器验收任务");
  await page.getByLabel(/^日期/).fill("2026-08-02");
  await page.getByLabel(/开始时间/).fill("10:30");
  await page.getByLabel(/预计分钟/).fill("45");
  await page.getByLabel(/优先级/).selectOption("high");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("浏览器验收任务")).toBeVisible();
  await page.getByRole("link", { name: "首页总览" }).click();
  const row = page.locator(".plan-row").filter({ hasText: "浏览器验收任务" });
  await expect(row).toContainText("10:30");
  await row.getByRole("button", { name: "标记完成" }).click();
  await expect(row).toHaveClass(/is-done/);
  await expect(page.locator(".overview-strip")).toContainText("100");
});

test("creates media content and finds it through global search", async ({ page }) => {
  await page.goto("/media");
  await page.getByRole("button", { name: "记录内容" }).click();
  await page.getByLabel(/内容标题/).fill("可搜索的内容灵感");
  await page.getByLabel(/^平台/).fill("B站");
  await page.getByLabel(/内容形式/).fill("视频");
  await page.getByLabel(/制作阶段/).selectOption("producing");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("可搜索的内容灵感")).toBeVisible();
  await page.getByRole("button", { name: /搜索所有内容/ }).click();
  await page.getByPlaceholder("输入关键词").fill("可搜索");
  await expect(page.getByRole("button", { name: "可搜索的内容灵感", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  const card = page.locator(".media-card").filter({ hasText: "可搜索的内容灵感" });
  await card.locator(".icon-button").click();
  await card.locator(".row-menu").getByRole("button", { name: "编辑详情", exact: true }).click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel(/制作阶段/).selectOption("published");
  await editor.getByLabel(/实际发布日期/).fill("2026-08-02");
  await editor.getByLabel(/播放或阅读/).fill("1387");
  await editor.getByLabel(/^点赞/).fill("94");
  await editor.getByLabel(/^评论/).fill("17");
  await editor.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("img", { name: "发布后视频数据图表" })).toBeVisible();
  await expect(page.getByText("1,387", { exact: true })).toBeVisible();
  await expect(page.getByText("8.0%", { exact: true })).toBeVisible();
});

test("keeps linked plan titles live and opens the source module", async ({ page, request }) => {
  const media = await create(request, "mediaContents", { title: "原始来源标题", stage: "producing" });
  await create(request, "planItems", { title: "旧的副本标题", plan_date: "2026-08-02", source_module: "media", source_entity_type: "media_content", source_entity_id: media.id });
  expect((await request.patch(`/api/collections/mediaContents/${media.id}`, { data: { title: "来源更新后的标题" } })).ok()).toBeTruthy();
  await page.goto("/today");
  const row = page.locator(".plan-table-row").filter({ hasText: "来源更新后的标题" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /打开来源/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "自媒体" })).toBeVisible();
});

test("auto-saves a quick memo across reload and converts it into today's plan", async ({ page }) => {
  await page.goto("/");
  const memo = page.getByLabel("快速备忘");
  await memo.fill("自动保存并转换的备忘");
  await expect(page.getByRole("status")).toContainText("已保存", { timeout: 5_000 });
  await page.reload();
  await expect(page.getByLabel("快速备忘")).toHaveValue("自动保存并转换的备忘");
  await page.getByRole("button", { name: "转为今日事项" }).click();
  await page.getByRole("link", { name: "今日计划" }).click();
  await expect(page.getByText("自动保存并转换的备忘")).toBeVisible();
});

test("renders distinct records in every specialized module", async ({ page, request }) => {
  const devProject = await create(request, "devProjects", { name: "验收开发项目", status: "active" });
  const milestone = await create(request, "devMilestones", { project_id: devProject.id, name: "验收里程碑", target_date: "2026-08-20", status: "open" });
  await create(request, "devWorkItems", { project_id: devProject.id, milestone_id: milestone.id, title: "验收 Bug", item_type: "bug", priority: "high", status: "todo" });
  const client = await create(request, "clients", { name: "验收咨询客户" });
  const consult = await create(request, "consultingProjects", { client_id: client.id, name: "验收咨询项目", status: "active" });
  await create(request, "consultingDeliverables", { project_id: consult.id, name: "验收交付物", due_date: "2026-08-10", status: "todo" });
  const template = await create(request, "workoutTemplates", { name: "验收力量训练", weekday: 2 });
  await create(request, "workoutTemplateExercises", { template_id: template.id, name: "验收深蹲", target_sets: 3, target_reps: 5, target_weight: 60 });
  const meal = await create(request, "meals", { meal_date: "2026-08-02", meal_type: "dinner", name: "验收晚餐", entry_kind: "actual" });
  await create(request, "mealItems", { meal_id: meal.id, food_name: "验收食物", quantity: 1, calories: 420, protein: 31 });
  await create(request, "entertainmentItems", { name: "验收游戏", platform: "Steam", status: "playing", next_goal: "完成第一章" });

  for (const [path, text] of [["/development", "验收 Bug"], ["/consulting", "验收交付物"], ["/fitness", "验收深蹲"], ["/diet", "验收晚餐"], ["/entertainment", "验收游戏"]]) {
    await page.goto(path);
    await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
  }
});

test("restores trash, persists theme, creates backup and downloads export", async ({ page, request }) => {
  const media = await create(request, "mediaContents", { title: "可恢复验收记录", stage: "idea" });
  expect((await request.delete(`/api/collections/mediaContents/${media.id}`)).ok()).toBeTruthy();
  await page.goto("/settings");
  await expect(page.getByText("app.sqlite", { exact: true })).toBeVisible();
  const trashRow = page.locator(".trash-list article").filter({ hasText: "可恢复验收记录" });
  await expect(trashRow).toBeVisible();
  await trashRow.getByRole("button", { name: "恢复" }).click();
  await expect(trashRow).toHaveCount(0);

  await page.getByRole("button", { name: "深色" }).click();
  await page.getByLabel("自媒体").uncheck();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByLabel("自媒体")).not.toBeChecked();

  await page.getByRole("button", { name: "立即备份" }).click();
  const manualBackup = page.locator(".backup-list article").filter({ hasText: "手动" }).first();
  await expect(manualBackup).toBeVisible();
  const backupName = manualBackup.getByRole("textbox");
  await backupName.fill("浏览器验收备份");
  await backupName.blur();
  await expect(backupName).toHaveValue("浏览器验收备份");

  await page.getByRole("link", { name: "首页总览" }).click();
  await expect(page.locator(".summary-tile").filter({ hasText: "自媒体" })).toHaveCount(0);
  await page.getByRole("link", { name: "数据与设置" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 ZIP" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/muzi-export-.*\.zip/);
});
