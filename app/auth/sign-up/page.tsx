'use client'

import React, { useState } from "react"
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'

export default function SignUpPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [role, setRole] = useState<'patient' | 'doctor'>('patient')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()
  const { register } = useAuth()

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    if (password !== repeatPassword) {
      setError('Passwords do not match')
      setIsLoading(false)
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      setIsLoading(false)
      return
    }

    try {
      await register(email, password, role)
      router.push('/chat')
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#FFFAF8] via-[#FFF5F2] to-[#FFEBE5] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col gap-6">
          <div className="text-center mb-4">
            <div className="w-16 h-16 bg-[#FFAB91]/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-[#FFAB91]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-[#2D3436] tracking-tight">ArogyaMitra</h1>
            <p className="text-[#636E72] font-medium mt-1">Create Your Account</p>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4">
            <div className="flex items-start gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1">
                <p className="text-sm font-bold text-amber-900 mb-1">Try Demo Accounts</p>
                <div className="text-xs text-amber-800 space-y-1">
                  <p><strong>Doctor:</strong> doctor@demo.com | Password: 123456</p>
                  <p><strong>Patient:</strong> patient@demo.com | Password: 123456</p>
                  <p className="text-amber-700 mt-2">Tip: Open two browser windows to test doctor-patient interaction</p>
                </div>
              </div>
            </div>
          </div>

          <Card className="border-0 shadow-xl">
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl text-[#2D3436]">Sign Up</CardTitle>
              <CardDescription className="text-[#636E72]">
                Join ArogyaMitra for secure medical consultations
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSignUp}>
                <div className="flex flex-col gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="fullName" className="text-[#2D3436] font-semibold">Full Name</Label>
                    <Input
                      id="fullName"
                      type="text"
                      placeholder="naam likho apna"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="h-12 rounded-xl border-stone-200 focus:border-[#FFAB91] focus:ring-[#FFAB91]/20"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="email" className="text-[#2D3436] font-semibold">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="email@your.com"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-12 rounded-xl border-stone-200 focus:border-[#FFAB91] focus:ring-[#FFAB91]/20"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label className="text-[#2D3436] font-semibold">I am a</Label>
                    <div className="grid grid-cols-2 gap-3">
                      <div
                        onClick={() => setRole('patient')}
                        className={`cursor-pointer border rounded-xl p-3 flex flex-col items-center gap-2 transition-all ${role === 'patient' ? 'bg-blue-50 border-blue-500 ring-2 ring-blue-200' : 'bg-white border-stone-200 hover:border-blue-200'}`}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${role === 'patient' ? 'bg-blue-500 text-white' : 'bg-stone-100 text-stone-400'}`}>
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        </div>
                        <span className={`text-sm font-bold ${role === 'patient' ? 'text-blue-700' : 'text-stone-500'}`}>
                          Patient
                        </span>
                      </div>

                      <div
                        onClick={() => setRole('doctor')}
                        className={`cursor-pointer border rounded-xl p-3 flex flex-col items-center gap-2 transition-all ${role === 'doctor' ? 'bg-emerald-50 border-emerald-500 ring-2 ring-emerald-200' : 'bg-white border-stone-200 hover:border-emerald-200'}`}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${role === 'doctor' ? 'bg-emerald-500 text-white' : 'bg-stone-100 text-stone-400'}`}>
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                          </svg>
                        </div>
                        <span className={`text-sm font-bold ${role === 'doctor' ? 'text-emerald-700' : 'text-stone-500'}`}>
                          Doctor
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="password" className="text-[#2D3436] font-semibold">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-12 rounded-xl border-stone-200 focus:border-[#FFAB91] focus:ring-[#FFAB91]/20"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="repeat-password" className="text-[#2D3436] font-semibold">Confirm Password</Label>
                    <Input
                      id="repeat-password"
                      type="password"
                      required
                      value={repeatPassword}
                      onChange={(e) => setRepeatPassword(e.target.value)}
                      className="h-12 rounded-xl border-stone-200 focus:border-[#FFAB91] focus:ring-[#FFAB91]/20"
                    />
                  </div>
                  {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
                      {error}
                    </div>
                  )}
                  <Button
                    type="submit"
                    className="w-full h-12 bg-[#FFAB91] hover:bg-[#FF9A7B] text-white rounded-xl font-bold text-base shadow-lg shadow-[#FFAB91]/30 mt-2"
                    disabled={isLoading}
                  >
                    {isLoading ? 'Creating account...' : 'Create Account'}
                  </Button>
                </div>
                <div className="mt-6 text-center text-sm text-[#636E72]">
                  Already have an account?{' '}
                  <Link
                    href="/auth/login"
                    className="text-[#FFAB91] font-semibold hover:underline"
                  >
                    Sign in
                  </Link>
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="flex items-center justify-center gap-2 text-xs text-[#636E72]/70">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>Your data is encrypted and secure</span>
          </div>
        </div>
      </div>
    </div>
  )
}
