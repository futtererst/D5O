/** Navigate the selected Work's Design sections through the layout in use. */
export async function chooseDesignSection(page, label) {
  const selector = page.getByRole("combobox", { name: "Design section" });
  if (await selector.isVisible()) await selector.selectOption({ label });
  else await page.getByRole("navigation", { name: "Design sections" }).getByRole("button", { name: label, exact: true }).click();
}

export async function chooseDesignPackage(page, name) {
  await page.getByRole("combobox", { name: "Design package" }).selectOption({ label: name });
}
