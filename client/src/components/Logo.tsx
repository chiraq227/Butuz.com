import { useTheme } from '../contexts/ThemeContext';

// Import all logo variants
import logoIconLight from '../assets/logos/logo-icon-light.svg';
import logoIconDark from '../assets/logos/logo-icon-dark.svg';
import logoFullLight from '../assets/logos/logo-full-light.svg';
import logoFullDark from '../assets/logos/logo-full-dark.svg';

interface LogoProps {
  /** 'icon' = small symbol only (for header), 'full' = complete logo with text */
  variant?: 'icon' | 'full';
  className?: string;
  alt?: string;
}

export default function Logo({ 
  variant = 'icon', 
  className = '', 
  alt = 'Бутуз' 
}: LogoProps) {
  const { themeId } = useTheme();
  const isDark = themeId === 'dark' || themeId.startsWith('dark');

  let src;
  let additionalClass = '';

  if (variant === 'full') {
    // Always use the ready full logo that includes the letters (light full has explicit text "utuz")
    // For dark theme we adapt the same ready lettered logo with filter so letters are visible
    src = logoFullLight;
    if (isDark) {
      additionalClass = 'logo-dark';
    }
  } else {
    src = isDark ? logoIconDark : logoIconLight;
  }

  // Sensible default sizing
  const defaultClass = variant === 'full' 
    ? 'h-14 w-auto max-w-[220px]' 
    : 'h-9 w-9 object-contain';

  return (
    <img 
      src={src} 
      alt={alt} 
      className={`${defaultClass} ${className} ${additionalClass}`.trim()} 
      draggable={false}
    />
  );
}
