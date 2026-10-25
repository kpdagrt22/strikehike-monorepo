# Astro Finance Design Inspiration Board

## Overview

This document consolidates design insights from **Apple**, **TradingView**, **Linear**, and **Stripe** to create a unified visual and UX strategy for Astro Finance.

**Core Strategy:**  
- **Homepage/Marketing:** **Apple-inspired** (spacious, elegant, generous white space)
- **Trading Dashboard:** **Linear + TradingView-inspired** (dark, dense, professional, glassmorphism)
- **Data Presentation:** **Stripe-inspired** (metric cards, clear tables, trustworthy)

---

## 🎨 Color Palette

### Homepage (Light Mode)
```css
--bg-primary: #ffffff;           /* Pure white */
--bg-secondary: #f5f5f7;         /* Apple light grey for sections */
--text-primary: #1d1d1f;         /* Apple almost-black */
--text-secondary: #86868b;       /* Apple cool grey */
--accent-primary: #6366f1;       /* Indigo-500 (purple, Linear/Stripe-inspired) */
--accent-hover: #4f46e5;         /* Indigo-600 */
--border-subtle: #e3e8ee;        /* Stripe border grey */
```

### Trading Dashboard (Dark Mode)
```css
--bg-primary: #08090a;           /* Linear deep charcoal (NOT pure black) */
--bg-secondary: #121214;         /* Slightly lighter for cards */
--bg-tertiary: #1a1b1e;          /* Even lighter for elevated elements */
--text-primary: #ffffff;
--text-secondary: rgba(255,255,255,0.6);
--text-tertiary: rgba(255,255,255,0.4);
--accent-primary: #6366f1;       /* Purple */
--accent-glow: rgba(99,102,241,0.5);
--border-subtle: rgba(255,255,255,0.08);  /* Linear subtle border */
--border-elevated: rgba(255,255,255,0.12);
```

### Data Visualization
```css
--chart-purple: #635bff;         /* Stripe primary */
--chart-blue: #2962ff;           /* TradingView blue */
--chart-teal: #1ce2c2;           /* Stripe teal */
--chart-green: #00d924;          /* Success */
--chart-red: #ff5a1f;            /* Warning/Negative */
--chart-orange: #ff9f5a;         /* Neutral alert */
```

---

## 📐 Typography System

### Font Families
```css
--font-sans: "Inter Variable", "SF Pro Display", -apple-system, system-ui, sans-serif;
--font-mono: "SF Mono", "Consolas", monospace; /* For tabular numbers */
```

### Scale & Hierarchy

| Element | Size | Weight | Line Height | Letter Spacing | Usage |
|---------|------|--------|-------------|----------------|-------|
| **Hero H1** | 72px | 600 | 1.05 | -0.03em | Homepage hero ("The Moon Moves Markets") |
| **Section H2** | 48px | 600 | 1.08 | -0.02em | Homepage section headers |
| **Dashboard H3** | 24px | 600 | 1.2 | -0.01em | Dashboard section headers |
| **Large Metric** | 32px | 600 | 1.2 | -0.01em | Sharpe Ratio, Max DD display |
| **Body Text** | 17-19px | 400 | 1.47 | 0.01em | Content, descriptions |
| **Dashboard Body** | 14px | 400 | 1.5 | 0.01em | Table cells, labels |
| **Metadata** | 11-12px | 600 | 1.4 | 0.02em | Timestamps, tags (uppercase) |
| **Kicker** | 12px | 600 | 1.2 | 0.08em | Small labels above headlines (uppercase) |

### Key Rules
- **Tabular Numbers:** All financial metrics must use `font-variant-numeric: tabular-nums`
- **Tight Tracking:** Headlines use negative letter-spacing (-0.02 to -0.03em)
- **Wide Tracking:** Small uppercase labels use positive letter-spacing (0.02-0.08em)

---

## 📏 Spacing System

### Vertical Rhythm (8px Base Unit)
```css
--space-1: 8px;
--space-2: 16px;
--space-3: 24px;
--space-4: 32px;
--space-5: 40px;
--space-6: 48px;
--space-8: 64px;
--space-10: 80px;
--space-12: 96px;
--space-15: 120px;
--space-20: 160px;
```

### Component-Specific Padding

| Component | Padding | Usage |
|-----------|---------|-------|
| **Homepage Section** | 100-120px vertical | Between major sections (Apple) |
| **Feature Card (Bento Box)** | 40px all | Large homepage feature cards |
| **Dashboard Metric Card** | 24-32px all | Track record metrics (Stripe) |
| **Table Row** | 16px V / 20px H | Data tables (Stripe) |
| **Issue/Prediction Card** | 12px V / 16px H | Dense dashboard lists (Linear) |
| **Button** | 12px V / 24px H | Standard button padding |

---

## 🔲 Border Radius

```css
--radius-sm: 6px;    /* Nav items, small buttons */
--radius-md: 8px;    /* Default buttons, dashboard cards */
--radius-lg: 12px;   /* Feature cards, modals */
--radius-xl: 20px;   /* Homepage Bento Box cards (Apple) */
--radius-full: 9999px; /* Pills (Apple CTAs) */
```

### Chart Border Radius
- **Bar Charts:** 4px on top corners only (Stripe)
- **Container:** 8-12px (standard)

---

## 🪟 Glassmorphism & Blur Effects

### Sticky Navigation
```css
.sticky-nav {
  background: rgba(255,255,255,0.8);     /* Light mode */
  backdrop-filter: saturate(1.8) blur(20px);
  border-bottom: 1px solid rgba(0,0,0,0.1);
}

.sticky-nav-dark {
  background: rgba(18,18,20,0.8);        /* Dark mode */
  backdrop-filter: saturate(1.5) blur(20px);
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
```

### Command Palette (Linear-inspired)
```css
.command-palette {
  background: rgba(18,18,20,0.9);
  backdrop-filter: saturate(1.5) blur(32px);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px;
  box-shadow: 0 16px 70px rgba(0,0,0,0.5);
}
```

### Modal Overlays
```css
.modal-backdrop {
  background: rgba(0,0,0,0.7);
  backdrop-filter: blur(8px);
}
```

---

## 📊 Component Patterns

### 1. Bento Box Grid (Homepage Features)

**Inspired by:** Apple

```html
<div class="bento-grid">
  <div class="card large">Moon Phase Tracker</div>  <!-- 2 columns-->
  <div class="card small">Crash Predictor</div>    <!-- 1 column -->
  <div class="card small">Planetary Aspects</div>  <!-- 1 column -->
  <div class="card large">Walk-Forward Results</div> <!-- 2 columns -->
</div>
```

```css
.bento-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.card {
  background: #f5f5f7;
  border-radius: 20px;
  padding: 40px;
  transition: all 0.3s ease;
}

.card.large {
  grid-column: span 2;
}

.card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 32px rgba(0,0,0,0.12);
}
```

---

### 2. Metric Card (Track Record)

**Inspired by:** Stripe

```html
<div class="metric-card">
  <div class="metric-label">Sharpe Ratio</div>
  <div class="metric-value">2.40</div>
  <div class="metric-delta positive">
    <span class="arrow">↑</span>
    <span>+12.5% vs. benchmark</span>
  </div>
  <svg class="sparkline"><!-- Chart --></svg>
</div>
```

```css
.metric-card {
  background: #ffffff;  /* Dark mode: #121214 */
  border: 1px solid #e3e8ee;  /* Dark: rgba(255,255,255,0.08) */
  border-radius: 8px;
  padding: 24px;
  transition: box-shadow 0.2s ease;
}

.metric-card:hover {
  box-shadow: 0 4px 12px rgba(99,102,241,0.15);  /* Purple glow */
}

.metric-label {
  font-size: 12px;
  font-weight: 600;
  color: #6366f1;  /* Purple */
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 8px;
}

.metric-value {
  font-size: 32px;
  font-weight: 600;
  color: #0a2540;  /* Dark mode: #ffffff */
  font-variant-numeric: tabular-nums;
  margin-bottom: 4px;
}

.metric-delta {
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 4px;
}

.metric-delta.positive { color: #00d924; }
.metric-delta.negative { color: #ff5a1f; }
```

---

### 3. Data Table (Prediction Ledger)

**Inspired by:** Stripe + Linear

```html
<table class="data-table">
  <thead>
    <tr>
      <th class="text-left">Date</th>
      <th class="text-right">Signal</th>
      <th class="text-right">Confidence</th>
      <th class="text-right">Result</th>
    </tr>
  </thead>
  <tbody>
    <tr class="table-row">
      <td>2024-01-15</td>
      <td class="text-right">Bullish</td>
      <td class="text-right">82%</td>
      <td class="text-right">+3.2%</td>
    </tr>
  </tbody>
</table>
```

```css
.data-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
}

.data-table thead th {
  font-size: 12px;
  font-weight: 600;
  color: #6366f1;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 12px 20px;
  border-bottom: 2px solid #e3e8ee;
  text-align: left;
}

.table-row {
  border-bottom: 1px solid #e3e8ee;  /* Dark: rgba(255,255,255,0.08) */
  transition: background 0.15s ease;
  height: 48px;  /* Stripe: 48-52px for readability */
}

.table-row:hover {
  background: #f6f9fc;  /* Dark: rgba(255,255,255,0.04) */
}

.table-row td {
  padding: 16px 20px;
  font-size: 14px;
  color: #0a2540;  /* Dark: #ffffff */
}

.text-right {
  text-align: right;
  font-variant-numeric: tabular-nums;  /* CRITICAL for alignment */
}
```

---

### 4. Issue Card (Dashboard Lists)

**Inspired by:** Linear

```html
<div class="issue-card">
  <span class="priority-icon">🔴</span>
  <div class="issue-content">
    <div class="issue-title">Crash Signal: Full Moon Approaching</div>
    <div class="issue-meta">
      <span class="issue-id">PRED-1234</span>
      <span class="issue-date">2 hours ago</span>
    </div>
  </div>
  <span class="confidence-badge">78%</span>
</div>
```

```css
.issue-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 8px;
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.06);
  transition: all 0.2s ease;
}

.issue-card:hover {
  background: rgba(255,255,255,0.04);
  border-color: rgba(99,102,241,0.5);  /* Purple glow */
  transform: translateY(-1px);  /* Hover lift */
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
}

.issue-title {
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
}

.issue-meta {
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: rgba(255,255,255,0.5);
  margin-top: 4px;
}

.confidence-badge {
  font-size: 12px;
  font-weight: 600;
  color: #00d924;
  padding: 4px 8px;
  background: rgba(0,217,36,0.1);
  border-radius: 6px;
}
```

---

### 5. Button Styles

**Inspired by:** Apple (pills) + Linear (hover effects)

```css
/* Primary CTA */
.btn-primary {
  background: #6366f1;
  color: #ffffff;
  padding: 12px 24px;
  border-radius: 9999px;  /* Full pill (Apple) */
  font-size: 17px;
  font-weight: 500;
  border: none;
  transition: all 0.2s ease;
}

.btn-primary:hover {
  background: #4f46e5;
  transform: translateY(-1px);
  box-shadow: 0 8px 20px rgba(99,102,241,0.3);
}

.btn-primary:active {
  transform: scale(0.98);  /* Press effect (Linear) */
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #6366f1;
  border: 1px solid #6366f1;
  padding: 12px 24px;
  border-radius: 9999px;
  transition: all 0.2s ease;
}

.btn-secondary:hover {
  background: #6366f1;
  color: #ffffff;
}

/* Text Link with Arrow (Apple) */
.link-arrow {
  color: #6366f1;
  font-size: 17px;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: gap 0.2s ease;
}

.link-arrow::after {
  content: '→';
  transition: transform 0.2s ease;
}

.link-arrow:hover {
  gap: 8px;  /* Arrow moves right */
}

.link-arrow:hover::after {
  transform: translateX(4px);
}
```

---

### 6. Chart Styling

**Inspired by:** Stripe + TradingView

```css
/* Line Chart */
.line-chart {
  --line-color: #635bff;        /* Stripe purple */
  --line-width: 2.5px;
  --grid-color: rgba(255,255,255,0.08);  /* Subtle horizontal lines */
}

/* Bar Chart */
.bar-chart rect {
  fill: #6366f1;
  rx: 4px;  /* Top corner radius only (Stripe) */
  ry: 0;
  transition: fill 0.2s ease;
}

.bar-chart rect:hover {
  fill: #4f46e5;  /* Darken on hover */
}

/* Candlestick (TradingView-inspired) */
.candle-up {
  fill: #089981;   /* TradingView green */
  stroke: #089981;
}

.candle-down {
  fill: #f23645;   /* TradingView red */
  stroke: #f23645;
}
```

---

## 🎬 Micro-Animations

**Inspired by:** Linear

### Hover Lift
```css
.interactive-card {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.interactive-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
}
```

### Button Press
```css
.button:active {
  transform: scale(0.98);
}
```

### Skeleton Loading (Instead of Spinners)
```css
@keyframes shimmer {
  0% { background-position: -200px 0; }
  100% { background-position: calc(200px + 100%) 0; }
}

.skeleton {
  background: linear-gradient(
    90deg,
    rgba(255,255,255,0.03) 0%,
    rgba(255,255,255,0.08) 50%,
    rgba(255,255,255,0.03) 100%
  );
  background-size: 200px 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
}
```

### Fade-in on Scroll (Apple)
```css
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.scroll-reveal {
  animation: fadeInUp 0.6s ease-out;
}
```

---

## 🎯 Implementation Priorities

### Phase 1: Foundation (IMMEDIATE)

1. **Create Design Tokens File** (`tokens.css` or `tailwind.config.js`)
   - Define all color variables
   - Set up spacing scale (8px base)
   - Configure typography scale
   - Define border-radius values

2. **Update `TrackRecordSummary` Component**
   - Implement Stripe metric card pattern
   - Add purple labels (12px, uppercase)
   - Use 32px tabular numbers
   - Implement green/red deltas

3. **Implement Tabular Numbers**
   - Add `font-variant-numeric: tabular-nums` to all financial metrics
   - Ensure right-alignment for all number columns

4. **Update Homepage Spacing**
   - Increase section vertical padding to 100-120px
   - Increase hero headline to 72px
   - Tighten letter-spacing to -0.03em

---

### Phase 2: Dashboard Transformation (WEEK 2)

5. **Dark Mode Implementation**
   - Switch dashboard to `#08090a` background
   - Implement glassmorphism on navigation
   - Add purple glow hover states

6. **Bento Box Feature Grid**
   - Create 2-column grid on homepage
   - Build 4 feature cards (Moon Tracker, Crash Predictor, Aspects, Results)
   - 20px border-radius, 40px padding

7. **Data Table Component**
   - Build with Stripe styling (48px rows, horizontal borders only)
   - Sticky headers
   - Right-aligned numbers
   - Hover states

---

### Phase 3: Polish & Animations (PHASE 6)

8. **Command Palette** (`Ctrl+K`)
   - Glassmorphic modal
   - Search input with instant results
   - Keyboard shortcut display

9. **Micro-Animations**
   - Hover lift on cards
   - Button press effect
   - Skeleton loading states
   - Fade-in on scroll (homepage)

10. **Chart Enhancements**
    - Implement purple gradient lines
    - 4px top corner radius for bars
    - Horizontal grid lines only

---

## 📚 Design System References

| Platform | Primary Learnings | Apply To |
|----------|------------------|----------|
| **Apple** | Generous spacing (100-160px), Bento Box grid, 56-80px headlines, glassmorphism | **Homepage/Marketing** |
| **Linear** | Dark mode (#08090a), command palette, dense spacing (12px), glassmorphism, purple accents | **Trading Dashboard** |
| **Stripe** | Metric cards, tabular numbers, 48px row height, right-aligned tables, trustworthy data viz | **Track Record, Data Tables** |
| **TradingView** | High-density charts, integrated legends, dark theme (#131722), multi-condition alerts | **Chart Interface** |

---

## 🎨 Visual Mood Board

### Homepage Aesthetic
- **Vibe:** Premium, spacious, elegant ("Apple Store website")
- **Colors:** Light grey backgrounds, purple accents, generous white space
- **Typography:** Large headlines (72px), tight tracking
- **Layout:** Bento Box grids, full-bleed backgrounds

### Dashboard Aesthetic
- **Vibe:** Professional, dense, focused ("Trading terminal")
- **Colors:** Deep charcoal background, purple highlights, subtle borders
- **Typography:** Tabular numbers, small metadata (11px)
- **Layout:** Tight spacing (12px), sidebar navigation, glassmorphic modals

### Data Presentation Aesthetic
- **Vibe:** Trustworthy, clear, scannable ("Financial report")
- **Colors:** Purple gradients, green/red indicators
- **Typography:** 32px metrics, uppercase labels (12px)
- **Layout:** Metric cards, clean tables, horizontal-only grid lines

---

## ✅ Design Checklist

- [ ] All colors match design tokens (no arbitrary hex codes in components)
- [ ] All spacing uses 8px multiples (8, 16, 24, 32, 40, 48, 64, 80, 96, 120, 160)
- [ ] All financial numbers use `font-variant-numeric: tabular-nums`
- [ ] All border-radius values use predefined tokens (6px, 8px, 12px, 20px, 9999px)
- [ ] Homepage section padding is 100-120px vertical
- [ ] Dashboard uses `#08090a` (NOT `#000`) background
- [ ] All interactive elements have hover states (lift, glow, or color change)
- [ ] All transitions are 0.15-0.2s (fast, not slow)
- [ ] Tables have 48-52px row height for readability
- [ ] Command palette uses `backdrop-filter: blur(32px)`

---

**Document Version:** 1.0  
**Last Updated:** 2026-01-12  
**Compiled by:** Antigravity AI  
**Total Research Time:** ~4 hours  
**Platforms Studied:** 4 (Apple, TradingView, Linear, Stripe)  
**Screenshots Captured:** 19 total  
**Browser Recordings:** 3 (total 18min 30sec)
