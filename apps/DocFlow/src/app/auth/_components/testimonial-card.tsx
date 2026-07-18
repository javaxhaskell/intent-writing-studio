export interface Testimonial {
  avatarSrc: string;
  name: string;
  handle: string;
  text: string;
}

interface TestimonialCardProps {
  testimonial: Testimonial;
  delay: string;
}

export const TestimonialCard = ({ testimonial, delay }: TestimonialCardProps) => (
  <div
    className="flex items-start gap-3 rounded-3xl bg-white/10 backdrop-blur-xl border border-white/10 p-5 w-64 animate-fade-in"
    style={{ animationDelay: delay }}
  >
    <img src={testimonial.avatarSrc} className="h-10 w-10 object-cover rounded-2xl" alt="avatar" />
    <div className="text-sm leading-snug">
      <p className="font-medium text-white">{testimonial.name}</p>
      <p className="text-white/60">{testimonial.handle}</p>
      <p className="mt-1 text-white/80">{testimonial.text}</p>
    </div>
  </div>
);

export const testimonials: Testimonial[] = [
  {
    avatarSrc: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah',
    name: 'Sarah Lin',
    handle: '@sarahlin',
    text: 'A fantastic platform. The experience is smooth and the features are exactly what I need.',
  },
  {
    avatarSrc: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Marcus',
    name: 'Marcus Lee',
    handle: '@marcuslee',
    text: 'This completely changed how I work. Clean design, powerful features, great support.',
  },
];
