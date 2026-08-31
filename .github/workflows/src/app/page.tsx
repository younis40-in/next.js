import Link from "next/link";
import { 
  Stamp, 
  FileText, 
  Gift, 
  Sparkles, 
  Package, 
  Palette, 
  Layers, 
  Printer, 
  ArrowLeft, 
  CheckCircle2 
} from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Header / Navbar */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 text-white p-2 rounded-xl shadow-md">
              <Printer className="w-6 h-6" />
            </div>
            <div>
              <span className="font-extrabold text-xl tracking-tight text-slate-900">YouAdv</span>
              <span className="text-xs block text-blue-600 font-semibold -mt-1">منصة الطباعة والبراندينج</span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
            <a href="#services" className="hover:text-blue-600 transition">خدمات الطباعة</a>
            <a href="#bundles" className="hover:text-blue-600 transition">باقات المشاريع</a>
            <a href="#studio" className="hover:text-blue-600 transition">استوديو المعاينة الحية</a>
          </nav>

          <div className="flex items-center gap-3">
            <Link 
              href="#studio" 
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-4 py-2 rounded-lg transition shadow-sm flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              <span>جرب المعاينة الحية</span>
            </Link>
          </div>
        </div>
      </header>
<meta name="google-site-verification" content="95b3CEDyi_XJgy6RFSuOsohAZbpmWW3o4oBjSHxzkdo" />
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-blue-50/50 via-white to-slate-50 py-20 lg:py-28 border-b border-slate-200/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <div className="inline-flex items-center gap-2 bg-blue-100/80 border border-blue-200 text-blue-800 text-xs font-bold px-3 py-1.5 rounded-full mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            <span>منصة متكاملة من التصميم والمعاينة إلى الطباعة والتسليم</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-slate-950 tracking-tight leading-tight max-w-4xl mx-auto">
            كل ما تحتاجه لهوية مشروعك <br className="hidden sm:inline" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
              في مكان واحد وبجودة طباعة فائقة
            </span>
          </h1>

          <p className="mt-6 text-lg sm:text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed">
            أختام مخصصة، دفاتر فواتير، باقات هوية بصرية وتغليف للمشاريع الناشئة، مع محاكي تصميم لمعاينة منتجك وتوليد ملف الطباعة فوراً.
          </p>

          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <a 
              href="#bundles" 
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-7 py-3.5 rounded-xl shadow-lg shadow-blue-500/25 transition flex items-center gap-2"
            >
              <span>استعرض باقات المشاريع</span>
              <ArrowLeft className="w-5 h-5" />
            </a>
            <a 
              href="#services" 
              className="bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 font-bold px-7 py-3.5 rounded-xl transition"
            >
              طلب طباعة مخصص
            </a>
          </div>
        </div>
      </section>

      {/* Main 3 Sections Grid */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 space-y-24">
        
        {/* Section 1: Direct Printing */}
        <section id="services" className="scroll-mt-24">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-10">
            <div>
              <span className="text-blue-600 font-bold text-sm tracking-wide">القسم الأول</span>
              <h2 className="text-3xl font-black text-slate-900 mt-1">خدمات الطباعة والمستلزمات المباشرة</h2>
              <p className="text-slate-600 mt-2">اختر المنتج وحدد المقاس والمواصفات واطلب مباشرة</p>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Card 1: Stamps */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition group">
              <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-5 group-hover:scale-110 transition">
                <Stamp className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">أختام مخصصة</h3>
              <p className="text-sm text-slate-600 mb-4">أختام كريستال، أوتوماتيك، وجيب بأحبار وألوان متعددة مع حفر ليزر عالي الدقة.</p>
              <span className="text-xs font-bold text-blue-600 inline-flex items-center gap-1 group-hover:underline">
                تخصيص الختم <ArrowLeft className="w-3.5 h-3.5" />
              </span>
            </div>

            {/* Card 2: Invoices */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition group">
              <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-5 group-hover:scale-110 transition">
                <FileText className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">فواتير ودفاتر تجارية</h3>
              <p className="text-sm text-slate-600 mb-4">دفاتر مكربنة، سندات قبض وصرف، مع ترقيم وتسليك دقيق حسب متطلبات شركتك.</p>
              <span className="text-xs font-bold text-emerald-600 inline-flex items-center gap-1 group-hover:underline">
                طلب دفاتر <ArrowLeft className="w-3.5 h-3.5" />
              </span>
            </div>

            {/* Card 3: Gifts */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition group">
              <div className="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center mb-5 group-hover:scale-110 transition">
                <Gift className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">هدايا ترويجية ودروع</h3>
              <p className="text-sm text-slate-600 mb-4">دروع تكريم، أقلام، مجات، وفلاشات مطبوعة باسم وشعار شركتك للمناسبات والفعاليات.</p>
              <span className="text-xs font-bold text-purple-600 inline-flex items-center gap-1 group-hover:underline">
                استعراض الهدايا <ArrowLeft className="w-3.5 h-3.5" />
              </span>
            </div>

            {/* Card 4: Office Stationery */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition group">
              <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mb-5 group-hover:scale-110 transition">
                <Package className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">أدوات ومطبوعات مكتبية</h3>
              <p className="text-sm text-slate-600 mb-4">أظرف رسمية، فولدرات أوراق، أوراق مراسلات Letterheads، ونوت بوك للشركات.</p>
              <span className="text-xs font-bold text-amber-600 inline-flex items-center gap-1 group-hover:underline">
                طلب مطبوعات <ArrowLeft className="w-3.5 h-3.5" />
              </span>
            </div>
          </div>
        </section>

        {/* Section 2: Branding Bundles */}
        <section id="bundles" className="scroll-mt-24 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white rounded-3xl p-8 sm:p-12 shadow-xl">
          <div className="max-w-3xl mb-12">
            <span className="text-indigo-400 font-bold text-sm">القسم الثاني</span>
            <h2 className="text-3xl sm:text-4xl font-black mt-1">باقات البراندينج والتغليف للمشاريع الناشئة</h2>
            <p className="text-slate-300 mt-2 text-base">
              حزمة واحدة متكاملة تجمع كل مستلزمات إطلاق علامتك التجارية بسعر موحد وخصم شامل.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Starter Bundle */}
            <div className="bg-white/10 backdrop-blur-sm border border-white/10 rounded-2xl p-6 flex flex-col justify-between hover:bg-white/15 transition">
              <div>
                <span className="text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-3 py-1 rounded-full">باقة الانطلاق</span>
                <h3 className="text-2xl font-black mt-4">Starter Pack</h3>
                <p className="text-sm text-slate-300 mt-2 mb-6">مناسبة للمشروعات الفردية والمتاجر المنزلية.</p>
                <ul className="space-y-3 text-sm text-slate-200">
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-indigo-400" /> 100 كارت شخصي فاخر</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-indigo-400" /> 200 ستيكر / ليبل دائري</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-indigo-400" /> 1 ختم أوتوماتيك شخصي</li>
                </ul>
              </div>
              <button className="mt-8 w-full bg-white text-slate-900 font-bold py-3 rounded-xl hover:bg-indigo-50 transition text-sm">
                اختيار هذه الباقة
              </button>
            </div>

            {/* Growth Bundle (Featured) */}
            <div className="bg-gradient-to-b from-blue-600 to-indigo-700 border-2 border-indigo-400 rounded-2xl p-6 flex flex-col justify-between shadow-2xl relative">
              <div className="absolute -top-3 right-6 bg-amber-400 text-slate-950 font-black text-xs px-3 py-1 rounded-full shadow">
                الأكثر طلباً ⭐
              </div>
              <div>
                <span className="text-xs font-bold bg-white/20 text-white px-3 py-1 rounded-full">باقة النمو المتكاملة</span>
                <h3 className="text-2xl font-black mt-4">Business Pro Pack</h3>
                <p className="text-sm text-blue-100 mt-2 mb-6">المجموعة الشاملة لهوية المتجر والمطبوعات.</p>
                <ul className="space-y-3 text-sm text-white">
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-amber-300" /> 500 كارت شخصي فاخر</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-amber-300" /> 500 ليبل واستيكر منتجات</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-amber-300" /> 100 شنطة ورقية / قماش مطبوعة</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-amber-300" /> 500 فلاير إعلاني ملون</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-amber-300" /> 1 ختم مكتب رسمي مع الحبر</li>
                </ul>
              </div>
              <button className="mt-8 w-full bg-amber-400 hover:bg-amber-300 text-slate-950 font-black py-3 rounded-xl transition text-sm shadow-md">
                تخصيص وطلب الباقة
              </button>
            </div>

            {/* Premium Corporate */}
            <div className="bg-white/10 backdrop-blur-sm border border-white/10 rounded-2xl p-6 flex flex-col justify-between hover:bg-white/15 transition">
              <div>
                <span className="text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-3 py-1 rounded-full">باقة الشركات</span>
                <h3 className="text-2xl font-black mt-4">Corporate Elite</h3>
                <p className="text-sm text-slate-300 mt-2 mb-6">حلول الهوية الكاملة للمكاتب والشركات الكبيرة.</p>
                <ul className="space-y-3 text-sm text-slate-200">
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-indigo-400" /> كروت أعمال + أظرف وفولدرات</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-indigo-400" /> دفاتر فواتير وسندات مرقمة</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-indigo-400" /> أختام شمعية وليزر رسمية</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-indigo-400" /> هدايا ترحيبية للموظفين والعملاء</li>
                </ul>
              </div>
              <button className="mt-8 w-full bg-white text-slate-900 font-bold py-3 rounded-xl hover:bg-indigo-50 transition text-sm">
                طلب عرض مخصص
              </button>
            </div>
          </div>
        </section>

        {/* Section 3: Live Interactive Mockup Studio Teaser */}
        <section id="studio" className="scroll-mt-24 border border-blue-200 bg-white rounded-3xl p-8 sm:p-12 shadow-sm">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-800 text-xs font-bold px-3 py-1.5 rounded-full mb-4">
                <Sparkles className="w-3.5 h-3.5" />
                <span>القسم الثالث: الأداة الذكية</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-black text-slate-900 leading-tight">
                استوديو التصميم والمعاينة الحية وتوليد ملفات الطباعة
              </h2>
              <p className="text-slate-600 mt-4 leading-relaxed">
                اكتب بيانات شركتك، اختر نوع الخط العربي المفضل، وارفع شعارك لترى شكل الختم، الكارت، أو الشنطة مطبوعاً أمامك مباشرة مع إمكانية تصدير ملف جاهز للطباعة فوراً.
              </p>

              <div className="mt-8 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-blue-50 text-blue-600 font-bold">1</div>
                  <div>
                    <h4 className="font-bold text-slate-900">معاينة واقعية (Live 2D Mockup)</h4>
                    <p className="text-xs text-slate-500">رؤية حية لمنتجك قبل تأكيد الطلب لتجنب أي أخطاء مطبعية.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-blue-50 text-blue-600 font-bold">2</div>
                  <div>
                    <h4 className="font-bold text-slate-900">تصدير بدقة عالية (Print-Ready Export)</h4>
                    <p className="text-xs text-slate-500">توليد ملفات متجهة (Vector/PDF) مطابقة للمقاسات المطلوبة لماكينات الطباعة والليزر.</p>
                  </div>
                </div>
              </div>

              <div className="mt-8">
                <button className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-8 py-3.5 rounded-xl shadow-md transition flex items-center gap-2">
                  <Palette className="w-5 h-5" />
                  <span>فتح استوديو التصميم الآن</span>
                </button>
              </div>
            </div>

            {/* Interactive Preview Simulation Box */}
            <div className="bg-slate-100 rounded-2xl p-6 border border-slate-200 flex flex-col items-center justify-center min-h-[360px] relative">
              <div className="bg-white p-8 rounded-xl shadow-lg border border-slate-200 text-center max-w-xs w-full">
                <div className="border-4 border-dashed border-blue-600/60 rounded-full w-40 h-40 mx-auto flex flex-col items-center justify-center p-4 text-blue-900">
                  <span className="text-xs font-bold text-blue-500">★ يونس للإعلان ★</span>
                  <span className="text-sm font-extrabold my-1">YouAdv Studio</span>
                  <span className="text-[10px] text-slate-500">العتبة - القاهرة</span>
                  <span className="text-[9px] text-blue-700 mt-1 font-mono">2026</span>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-400">
                  معاينة ختم دائري (قطر 4 سم)
                </div>
              </div>
              <span className="absolute bottom-3 text-[11px] font-semibold text-slate-500 bg-white/80 px-3 py-1 rounded-full border border-slate-200">
                ⚡ محاكي المعاينة والتصدير التفاعلي
              </span>
            </div>
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 mt-auto py-8">
        <div className="max-w-7xl mx-auto px-4 text-center text-sm text-slate-500">
          © {new Date().getFullYear()} YouAdv - منصة الطباعة والبراندينج المتكاملة. جميع الحقوق محفوظة.
        </div>
      </footer>
    </div>
  );
}
