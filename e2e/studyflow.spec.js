const {test,expect}=require('@playwright/test');
async function student(page){await page.goto('/student-login');await page.getByLabel('Email or existing student code').fill('FE-E-E1-36');await page.getByLabel('Password',{exact:true}).fill('student123');await page.getByRole('button',{name:'Sign In',exact:true}).click();await expect(page).toHaveURL(/student-dashboard/);}
async function teacher(page){await page.goto('/teacher-login');await page.getByPlaceholder(/prof@college.edu/).fill('teacher@studyflow.dev');await page.locator('input[type=password]').first().fill('Teach#2026');await page.getByRole('button',{name:/Sign In to Dashboard/}).click();await expect(page).toHaveURL(/teacher-dashboard/);}
async function facultyNav(page,name){await page.getByRole('navigation',{name:'Faculty navigation',includeHidden:true}).waitFor({state:'attached'});const menu=page.getByRole('button',{name:'Open menu',exact:true});if(await menu.isVisible())await menu.click();await page.getByRole('navigation',{name:'Faculty navigation'}).getByRole('button',{name,exact:true}).click();}
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();}

test('distinctive cover and student navigation fit the viewport',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.getByRole('heading',{name:/Make room/})).toBeVisible();await noOverflow(page);
 await page.screenshot({path:`artifacts/ui/new-cover-${info.project.name}.png`,fullPage:true,animations:'disabled'});
 await student(page);await expect(page.getByRole('heading',{name:/Good to see you/})).toBeVisible();await noOverflow(page);
 await page.screenshot({path:`artifacts/ui/new-student-${info.project.name}.png`,fullPage:true,animations:'disabled'});
 const nav=page.getByRole('navigation',{name:'Student navigation'});
 await nav.getByRole('button',{name:'Materials',exact:true}).click();await expect(page.getByRole('heading',{name:'Your reading shelf'})).toBeVisible();
 await nav.getByRole('button',{name:'Attendance',exact:true}).click();await expect(page.getByRole('heading',{name:'Your attendance',exact:true})).toBeVisible();await noOverflow(page);
 await nav.getByRole('button',{name:/Notices/}).click();await expect(page.getByRole('heading',{name:'The notice board'})).toBeVisible();expect(errors).toEqual([]);
});
test('faculty workspace, drawer and responsive student directory',async({page},info)=>{
 await teacher(page);await expect(page.getByRole('heading',{name:/A good day to/})).toBeVisible();await noOverflow(page);
 await page.screenshot({path:`artifacts/ui/new-faculty-${info.project.name}.png`,fullPage:true,animations:'disabled'});
 await facultyNav(page,'Student directory');await expect(page.getByRole('heading',{name:'Student Directory',exact:true})).toBeVisible();await noOverflow(page);
 await page.screenshot({path:`artifacts/ui/new-directory-${info.project.name}.png`,fullPage:true,animations:'disabled'});
 await facultyNav(page,'Timetable');await page.getByText('+ Add a weekly class',{exact:true}).click();await page.getByRole('combobox',{name:'Class',exact:true}).selectOption('10');await page.getByLabel('Title',{exact:true}).fill('Weekly maths');await page.getByLabel('Starts').fill('09:00');await page.getByLabel('Ends').fill('10:00');await page.getByRole('button',{name:'Save & share'}).click();await expect(page.getByText('Saved. Your class is up to date.')).toBeVisible();
});
test('teacher publishes an assignment and student submits work',async({page},info)=>{
 await teacher(page);await facultyNav(page,'Assignments');await page.getByText('+ Publish an assignment',{exact:true}).click();await page.getByRole('combobox',{name:'Class',exact:true}).selectOption('10');await page.getByLabel('Title',{exact:true}).fill(`Practice ${info.project.name}`);await page.getByLabel('Due date and time').fill('2099-10-30T12:00');await page.getByLabel('Instructions').fill('Solve and explain the first exercise.');await page.getByRole('button',{name:'Save & share'}).click();await expect(page.getByText('Saved. Your class is up to date.')).toBeVisible();
 await student(page);await page.getByRole('navigation',{name:'Student navigation'}).getByRole('button',{name:'Planner'}).click();await page.getByRole('button',{name:'Assignments',exact:true}).click();const card=page.locator('article').filter({has:page.getByRole('heading',{name:`Practice ${info.project.name}`,exact:true})});await card.locator('summary').click();await card.getByLabel('Your answer').fill('My completed explanation.');await card.getByRole('button',{name:'Submit work',exact:true}).click();await expect(page.getByText('Saved. Your class is up to date.')).toBeVisible();await expect(card.getByText('My completed explanation.',{exact:true})).toBeVisible();
});
test('a saved private PDF reopens after an offline reload',async({page,request},info)=>{
 const auth=await request.post('/api/auth/teacher/login',{data:{email:'teacher@studyflow.dev',password:'Teach#2026'}});const {token}=await auth.json();
 const title=`Offline notes ${info.project.name}`;
 const uploaded=await request.post('/api/materials/upload',{headers:{Authorization:`Bearer ${token}`},multipart:{class_id:'10',unit_number:'1',title,file:{name:'notes.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF')}}});expect(uploaded.ok()).toBeTruthy();
 await student(page);await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
 await page.getByRole('navigation',{name:'Student navigation'}).getByRole('button',{name:'Materials',exact:true}).click();
 // Open the material through the protected application API and React viewer.
 await page.getByRole('heading',{name:'Applied Mathematics-I',exact:true}).click();await page.getByRole('heading',{name:title,exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'Save offline',exact:true}).click();await expect(page.getByText('Saved on this device. Available offline until sign-out.')).toBeVisible();await page.getByRole('button',{name:'Close ✕'}).click();
 await page.context().setOffline(true);await page.reload();await expect(page.getByText(/You’re offline/)).toBeVisible();await page.getByRole('button',{name:'Saved offline',exact:true}).click();const saved=page.locator('article').filter({has:page.getByRole('heading',{name:title,exact:true})});await saved.getByRole('button',{name:'Read ↗'}).click();await expect(page.getByRole('link',{name:'Download PDF'})).toHaveAttribute('href',/^blob:/);await page.context().setOffline(false);
});

test('small phones keep attendance controls inside the screen',async({page},info)=>{
 test.skip(info.project.name!=='android','Phone-specific layout check');
 await teacher(page);await facultyNav(page,'Take attendance');await expect(page.getByRole('button',{name:/Save Attendance for/})).toBeVisible();
 for(const width of [320,360,412]){await page.setViewportSize({width,height:820});await noOverflow(page);}
 await page.screenshot({path:'artifacts/ui/new-attendance-android.png',fullPage:true,animations:'disabled'});
});
test('new student invitation completes password setup in the browser',async({page,request},info)=>{
 const auth=await request.post('/api/auth/teacher/login',{data:{email:'teacher@studyflow.dev',password:'Teach#2026'}});const {token}=await auth.json();
 const created=await request.post('/api/students',{headers:{Authorization:`Bearer ${token}`},data:{name:'New Learner',academic_year:'FE',branch:'Common',division:'E',batch:'E1',roll_number:info.project.name==='android'?'A99':'D99'}});expect(created.status()).toBe(201);const {student:s}=await created.json();
 await page.goto('/student-login');await page.getByPlaceholder('FE-E-E1-36').fill(s.access_code);await page.getByLabel('Password',{exact:true}).fill(s.initial_password);await page.getByRole('button',{name:/Access Coursework/}).click();await expect(page.getByLabel('New password',{exact:true})).toBeVisible();await page.getByLabel('New password',{exact:true}).fill('My very own password!');await page.getByRole('button',{name:/Access Coursework/}).click();await expect(page).toHaveURL(/student-dashboard/);await expect(page.getByRole('heading',{name:/Good to see you, New/})).toBeVisible();
});

test('division discussion supports posting, replies and editing on every viewport',async({page},info)=>{
 await student(page);
 await page.getByRole('navigation',{name:'Student navigation'}).getByRole('button',{name:'Discussions',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Division discussions',exact:true})).toBeVisible();
 await page.getByText('Start a discussion',{exact:true}).click();
 const title=`Revision discussion ${info.project.name}`;
 await page.getByLabel('Title',{exact:true}).fill(title);
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('Which chapter should we revise first?');
 await page.getByRole('button',{name:'Post discussion',exact:true}).click();
 await expect(page.getByText('Discussion posted.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:title,exact:true}).click();
 await page.getByLabel('Your reply',{exact:true}).fill('Let us start with chapter one.');
 await page.getByRole('button',{name:'Post reply',exact:true}).click();
 await expect(page.getByText('Let us start with chapter one.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Edit',exact:true}).first().click();
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('Chapter one revision at five.');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.getByText('Chapter one revision at five.',{exact:true})).toBeVisible();
 await noOverflow(page);
 await page.screenshot({path:`artifacts/ui/discussions-${info.project.name}.png`,fullPage:true});
 await page.reload(); await expect(page.getByRole('button',{name:title,exact:true})).toBeVisible();
});


test('teacher grades an uploaded assignment and student sees feedback',async({page},info)=>{
 await teacher(page);await facultyNav(page,'Assignments');
 await page.getByText('+ Publish an assignment',{exact:true}).click();
 await page.getByRole('combobox',{name:'Class',exact:true}).selectOption('10');
 const title=`Graded work ${info.project.name}`;
 await page.getByLabel('Title',{exact:true}).fill(title);await page.getByLabel('Due date and time').fill('2099-10-30T12:00');await page.getByRole('button',{name:'Save & share'}).click();await expect(page.getByText('Saved. Your class is up to date.')).toBeVisible();
 await student(page);await page.getByRole('navigation',{name:'Student navigation'}).getByRole('button',{name:'Planner'}).click();await page.getByRole('button',{name:'Assignments',exact:true}).click();
 let card=page.locator('article').filter({has:page.getByRole('heading',{name:title,exact:true})});await card.locator('summary').click();await card.getByLabel('Your answer').fill('My solution with working attached.');await card.getByRole('button',{name:'Submit work',exact:true}).click();
 await card.locator('input[type=file]').setInputFiles({name:'solution.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF')});
 await expect(card.getByRole('button',{name:/solution.pdf/})).toBeVisible();
 await teacher(page);await facultyNav(page,'Assignments');card=page.locator('article').filter({has:page.getByRole('heading',{name:title,exact:true})});await card.locator('summary').click();
 await card.getByLabel('Marks',{exact:true}).fill('9');await card.getByLabel('Maximum marks',{exact:true}).fill('10');await card.getByRole('textbox',{name:'Feedback',exact:true}).fill('Clear explanation.');await card.getByRole('button',{name:'Save grade & feedback'}).click();await expect(card.getByText('Marks: 9 / 10',{exact:true})).toBeVisible();await noOverflow(page);
 await student(page);await page.getByRole('navigation',{name:'Student navigation'}).getByRole('button',{name:'Planner'}).click();await page.getByRole('button',{name:'Learning centre',exact:true}).click();await page.getByRole('button',{name:'Results',exact:true}).click();await expect(page.locator('article').filter({has:page.getByRole('heading',{name:title,exact:true})}).getByText('Clear explanation.',{exact:true})).toBeVisible();
});

test('learning centre publishes a quiz, checks answers and exposes admin controls',async({page},info)=>{
 await teacher(page);await facultyNav(page,'Learning centre');await page.getByRole('button',{name:'Practice quizzes',exact:true}).click();await page.getByText('Create a quiz',{exact:true}).click();
 await page.getByRole('combobox',{name:'Class',exact:true}).selectOption('10');const title=`Quick maths ${info.project.name}`;await page.getByLabel('Title',{exact:true}).fill(title);await page.getByRole('button',{name:'Save quiz',exact:true}).click();
 const card=page.locator('article').filter({has:page.getByRole('heading',{name:title,exact:true})});await card.getByRole('button',{name:'Manage quiz'}).click();
 await page.getByRole('textbox',{name:'Question',exact:true}).fill('What is two plus two?');for(const [letter,value]of [['A','1'],['B','2'],['C','3'],['D','4']])await page.getByLabel(`Option ${letter}`,{exact:true}).fill(value);
 await page.getByRole('combobox',{name:'Correct answer',exact:true}).selectOption('3');await page.getByRole('textbox',{name:'Explanation',exact:true}).fill('Two pairs make four.');await page.getByRole('button',{name:'Add question'}).click();await expect(page.getByRole('heading',{name:'1. What is two plus two?'})).toBeVisible();await page.getByRole('button',{name:'Publish quiz'}).click();await expect(page.getByRole('button',{name:'Publish quiz'})).toHaveCount(0);
 await facultyNav(page,'Administration');await expect(page.getByRole('heading',{name:'Administration'})).toBeVisible();await page.getByText('Departments',{exact:true}).click();await page.getByLabel('Department code').fill(info.project.name==='android'?'IT':'CE');await page.getByLabel('Department name').fill('Engineering');await page.getByRole('button',{name:'Add department'}).click();await expect(page.getByText('Saved successfully.',{exact:true})).toBeVisible();
 await student(page);await page.getByRole('navigation',{name:'Student navigation'}).getByRole('button',{name:'Planner'}).click();await page.getByRole('button',{name:'Learning centre',exact:true}).click();await page.getByRole('button',{name:'Practice quizzes',exact:true}).click();
 await page.locator('article').filter({has:page.getByRole('heading',{name:title,exact:true})}).getByRole('button',{name:'Start practice'}).click();await page.getByRole('radio',{name:'4',exact:true}).check();await page.getByRole('button',{name:'Check my answers'}).click();await expect(page.getByRole('heading',{name:'You scored 1 / 1'})).toBeVisible();await expect(page.getByText('Two pairs make four.',{exact:true})).toBeVisible();await noOverflow(page);await page.screenshot({path:`artifacts/ui/learning-${info.project.name}.png`,fullPage:true});
});




