import { NextResponse } from 'next/server'

const AIRFLOW_URL = process.env.NEXT_PUBLIC_AIRFLOW_URL || 'http://localhost:8090'
const AIRFLOW_USER = process.env.NEXT_PUBLIC_AIRFLOW_USER || 'admin'
const AIRFLOW_PASSWORD = process.env.NEXT_PUBLIC_AIRFLOW_PASSWORD || 'admin'

export async function GET() {
  try {
    const baseUrl = AIRFLOW_URL.replace(/\/$/, '')
    
    const loginPageRes = await fetch(`${baseUrl}/login`, {
      credentials: 'include',
    })
    const loginPageHtml = await loginPageRes.text()
    
    const csrfMatch = loginPageHtml.match(/name="csrf_token" value="([^"]+)"/)
    const csrfToken = csrfMatch ? csrfMatch[1] : ''

    const formData = new URLSearchParams()
    formData.append('username', AIRFLOW_USER)
    formData.append('password', AIRFLOW_PASSWORD)
    formData.append('csrf_token', csrfToken)
    formData.append('remember_me', 'true')

    const response = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': loginPageRes.headers.get('set-cookie') || '',
      },
      body: formData.toString(),
      credentials: 'include',
      redirect: 'manual',
    })

    const setCookieHeader = response.headers.get('set-cookie')

    if (setCookieHeader) {
      const nextResponse = NextResponse.redirect(`${baseUrl}/home`, {
        status: 302,
      })
      
      const cookies = setCookieHeader.split(',')
      for (const cookie of cookies) {
        const [cookiePart] = cookie.split(';')
        nextResponse.headers.append('Set-Cookie', cookiePart.trim())
      }
      
      return nextResponse
    }

    return NextResponse.redirect(`${baseUrl}/login`, { status: 302 })
  } catch (error) {
    console.error('Airflow login error:', error)
    return NextResponse.redirect(`${AIRFLOW_URL}/login`, { status: 302 })
  }
}
