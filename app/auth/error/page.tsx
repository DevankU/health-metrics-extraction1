import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>
}) {
  const params = await searchParams

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#FFFAF8] via-[#FFF5F2] to-[#FFEBE5] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col gap-6">
          <div className="text-center mb-4">
            <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
          </div>
          
          <Card className="border-0 shadow-xl">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl text-[#2D3436]">
                Authentication Error
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                {params?.error ? (
                  <p className="text-sm text-red-700">
                    Error: {params.error}
                  </p>
                ) : (
                  <p className="text-sm text-red-700">
                    An unexpected error occurred during authentication.
                  </p>
                )}
              </div>
              
              <div className="text-center pt-2">
                <Link 
                  href="/auth/login"
                  className="inline-flex items-center justify-center w-full h-12 bg-[#FFAB91] hover:bg-[#FF9A7B] text-white rounded-xl font-bold text-base shadow-lg shadow-[#FFAB91]/30 transition-colors"
                >
                  Back to Login
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
