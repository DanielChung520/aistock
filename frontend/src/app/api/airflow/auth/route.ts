import { NextResponse } from 'next/server'

const AIRFLOW_URL = process.env.NEXT_PUBLIC_AIRFLOW_URL || 'http://airflow.k84.org'

export async function GET() {
  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <title>正在跳轉到 Airflow...</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .container { text-align: center; }
    .spinner { border: 3px solid #f3f3f3; border-top: 3px solid #17a2b8; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 20px auto; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <h2>正在跳轉到 Airflow...</h2>
    <div class="spinner"></div>
    <p id="status">正在處理...</p>
  </div>
  <script>
    window.AIRFLOW_URL = '${AIRFLOW_URL}';
    
    async function loginAndRedirect() {
      try {
        const statusEl = document.getElementById('status');
        
        statusEl.textContent = '正在獲取登入頁面...';
        
        const loginRes = await fetch('/api/airflow/auth', {
          credentials: 'include'
        });
        
        if (!loginRes.ok) {
          statusEl.textContent = '獲取登入頁面失敗';
          return;
        }
        
        const html = await loginRes.text();
        
        const match = html.match(/name="csrf_token" value="([^"]+)"/);
        
        statusEl.textContent = '正在提交登入...';
        
        const formData = new URLSearchParams();
        formData.append('username', 'admin');
        formData.append('password', 'admin');
        formData.append('csrf_token', match ? match[1] : '');
        formData.append('remember_me', 'true');
        
        await fetch('/api/airflow/auth', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formData.toString(),
          credentials: 'include',
          redirect: 'manual'
        });
        
        statusEl.textContent = '正在跳轉...';
        
        window.location.href = window.AIRFLOW_URL + '/home';
        
      } catch (err) {
        console.error(err);
        document.getElementById('status').textContent = '錯誤: ' + err.message;
      }
    }
    
    loginAndRedirect();
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html',
    },
  });
}

export async function POST() {
  const baseUrl = AIRFLOW_URL.replace(/\/$/, '');
  
  try {
    const loginPageRes = await fetch(`${baseUrl}/login`, {
      credentials: 'include',
    });
    const loginPageHtml = await loginPageRes.text();
    
    const csrfMatch = loginPageHtml.match(/name="csrf_token" value="([^"]+)"/);
    const csrfToken = csrfMatch ? csrfMatch[1] : '';
    const existingCookie = loginPageRes.headers.get('set-cookie') || '';

    const formData = new URLSearchParams()
    formData.append('username', 'admin')
    formData.append('password', 'admin')
    formData.append('csrf_token', csrfToken)
    formData.append('remember_me', 'true')

    const response = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': existingCookie,
      },
      body: formData.toString(),
      credentials: 'include',
      redirect: 'manual',
    })

    const sessionCookies = response.headers.get('set-cookie') || '';

    return new NextResponse(loginPageHtml, {
      headers: {
        'Content-Type': 'text/html',
        'Set-Cookie': sessionCookies,
      },
    })
  } catch (error) {
    console.error('Airflow login error:', error)
    return NextResponse.json({ error: 'Login failed' }, { status: 500 })
  }
}
