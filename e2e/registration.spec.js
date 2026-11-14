const {test,expect}=require('@playwright/test');
test('student chooses own credentials and password controls stay in profile',async({page,request},info)=>{
 const auth=await request.post('/api/auth/teacher/login',{data:{email:'teacher@studyflow.dev',password:'Teach#2026'}});
 const {token}=await auth.json();
 const created=await request.post('/api/students',{headers:{Authorization:`Bearer ${token}`},data:{name:'Registration Test',academic_year:'FE',branch:'Common',division:'E',batch:'E1',roll_number:info.project.name==='desktop'?'901':'902'}});
 const {student}=await created.json();expect(student.initial_password).toBeUndefined();
 await page.goto('/student-login');await page.getByRole('button',{name:'Create Account',exact:true}).click();
 await page.getByLabel('Email address',{exact:true}).fill(`${info.project.name}@example.com`);
 await page.getByLabel('Registration code from your teacher').fill(student.registration_code);
 await page.getByLabel('Password',{exact:true}).fill('StudentPassword123!');await page.getByLabel('Confirm password',{exact:true}).fill('StudentPassword123!');
 await page.getByRole('button',{name:'Create Account',exact:true}).last().click();
 await expect(page.getByRole('status')).toContainText('Account created');
 await page.getByLabel('Password',{exact:true}).fill('StudentPassword123!');await page.getByRole('button',{name:'Sign In',exact:true}).last().click();
 await expect(page).toHaveURL(/student-dashboard/);
 await expect(page.locator('main').getByText('Change password',{exact:true})).toHaveCount(0);
 await page.getByLabel('Your profile').click();await page.locator('summary').filter({hasText:'Change password'}).click();
 await expect(page.getByLabel('Current password',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
