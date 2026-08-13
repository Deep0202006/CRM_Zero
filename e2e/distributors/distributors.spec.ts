import {expect,test,type Page} from "@playwright/test";const admin="10000000-0000-4000-a000-000000000003",employee="10000000-0000-4000-a000-000000000011";function token(id:string){const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString("base64url");return `${encode({alg:"none"})}.${encode({sub:id,exp:1999999999})}.e2e`}
async function seed(page:Page,id:string,isAdmin:boolean){await page.goto("/login");await page.waitForTimeout(300);await page.evaluate(async({id,accessToken,isAdmin})=>{const request=indexedDB.open("CRMDatabase"),database=await new Promise<IDBDatabase>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)}),transaction=database.transaction(["users","user_capabilities"],"readwrite");transaction.objectStore("users").put({user_id:id,name:isAdmin?"Admin User":"Employee",email:"user@example.test",is_active:1,created_at:new Date().toISOString()});if(isAdmin)transaction.objectStore("user_capabilities").put({id:`${id}-cap`,user_id:id,capability_code:"admin",assigned_at:new Date().toISOString()});await new Promise<void>((resolve,reject)=>{transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error)});database.close();localStorage.setItem("authenticated_user_id",id);localStorage.setItem("sb-e2e-auth-token",JSON.stringify({access_token:accessToken,refresh_token:"e2e",expires_at:1999999999,expires_in:999999999,token_type:"bearer",user:{id,aud:"authenticated",role:"authenticated",email:"user@example.test",app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}}))},{id,accessToken:token(id),isAdmin})}
const row={distributor_id:"40000000-0000-4000-a000-000000000001",distributor_name:"Alpha Distributor",distributor_reference:"ALPHA-1",lead_id:null,phone:null,city:"Delhi",assigned_to:employee,assigned_employee_name:"Employee",installation_status:"done",installation_completed_at:"2026-08-01",training_status:"done",training_completed_at:"2026-08-02",activity_status:"active",billing_status:"billed",billed_at:"2026-08-03",bill_reference:"INV-1",renewal_date:"2026-08-14",renewal_state:"renewal_due_tomorrow",version:2,updated_at:"2026-08-13T06:00:00Z"};
async function mock(page:Page){await page.route("https://e2e.supabase.co/**",route=>route.fulfill({status:200,contentType:"application/json",body:"[]"}));await page.route("**/api/distributors/metrics",route=>route.fulfill({json:{metrics:{total:1,installation_pending:0,installation_training_done:1,active:1,inactive:0,billed:1},assignees:[{user_id:employee,name:"Employee",email:"employee@example.test"}]}}));await page.route("**/api/distributors?**",route=>route.fulfill({json:{rows:[row],page:1,pageSize:50,total:1}}));await page.route("**/api/distributors/commands",route=>route.fulfill({json:{success:true,record:{...row,version:3}}}))}
for(const viewport of [{name:"desktop",width:1280,height:900},{name:"tablet",width:820,height:900},{name:"mobile",width:390,height:844}])test(`Admin Distributor Status is responsive and uses overlapping metrics on ${viewport.name}`,async({page})=>{await page.setViewportSize(viewport);await mock(page);await seed(page,admin,true);await page.goto("/admin/payments/distributors");await expect(page.getByRole("heading",{name:"Distributor Status"})).toBeVisible();await expect(page.getByRole("button",{name:/Installation \+ Training Done/})).toContainText("1");await expect(page.getByRole("button",{name:/Active/})).toContainText("1");await expect(page.getByRole("button",{name:/Billed/})).toContainText("1");await expect(page.getByText("Renewal tomorrow")).toBeVisible();await page.getByText("Alpha Distributor").click();await expect(page.getByRole("dialog")).toContainText("Operational facts only");await expect(page.getByRole("button",{name:"Mark Renewed / Set Next Renewal"})).toBeVisible()});
test("employee Distributor Status is assigned and read-only",async({page})=>{await mock(page);await seed(page,employee,false);await page.goto("/payments/distributors");await expect(page.getByText("Alpha Distributor")).toBeVisible();await expect(page.getByText("Renewal tomorrow")).toBeVisible();await expect(page.getByRole("button",{name:/Add Distributor|Import|Save Status/})).toHaveCount(0)});

test("Admin can edit distributor and progress through Training Pending lifecycle", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mock(page);
  await seed(page, admin, true);

  // Admin opens Distributor Status
  await page.goto("/admin/payments/distributors");
  await expect(page.getByRole("heading", { name: "Distributor Status" })).toBeVisible();

  // Click on the distributor to open editor
  await page.getByText("Alpha Distributor").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Verify employee assignment dropdown is populated (tests the root cause of the previous failure)
  const employeeSelect = dialog.locator('select[name="assigned_to"]');
  await expect(employeeSelect.locator('option')).toHaveCount(2); // "Select employee" + "Employee"
  await expect(employeeSelect).toHaveValue(employee);

  // Mark Installation complete, Training pending
  await dialog.locator('select[name="installation_status"]').selectOption('done');
  await dialog.locator('select[name="training_status"]').selectOption('pending');
  // It shouldn't let you mark active if training is pending
  await dialog.locator('select[name="activity_status"]').selectOption('not_applicable');

  await dialog.getByRole("button", { name: "Save Status" }).click();
  
  // This verifies that the UI accepts the Training Pending valid state
  await expect(dialog).toBeHidden();
});
