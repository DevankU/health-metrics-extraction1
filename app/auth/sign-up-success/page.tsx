import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import Link from 'next/link'

export default function SignUpSuccessPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#FFFAF8] via-[#FFF5F2] to-[#FFEBE5] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col gap-6">
          <div className="text-center mb-4">
            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
          
          <Card className="border-0 shadow-xl">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl text-[#2D3436]">
                Registration Successful!
              </CardTitle>
              <CardDescription className="text-[#636E72]">
                Please check your email to confirm your account
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-blue-600 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <div>
                    <p className="text-sm text-blue-800 font-medium">Check your inbox</p>
                    <p className="text-xs text-blue-600 mt-1">
                      We&apos;ve sent you a confirmation email. Click the link in the email to activate your account.
                      <br />
                      <span className="font-semibold">(Please check your spam/junk folder if you don&apos;t see it)</span>
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="text-center pt-2">
                <Link 
                  href="/auth/login"
                  className="inline-flex items-center justify-center w-full h-12 bg-[#FFAB91] hover:bg-[#FF9A7B] text-white rounded-xl font-bold text-base shadow-lg shadow-[#FFAB91]/30 transition-colors"
                >
                  Go to Login
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
