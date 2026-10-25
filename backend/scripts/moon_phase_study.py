"""
Moon Phase Replication Study - FIXED VERSION
=============================================

Replicates Yuan et al. (2006) finding that stock returns differ 
by 3-5% annually between new moon and full moon periods.
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from scipy import stats
from loguru import logger
import matplotlib.pyplot as plt
import seaborn as sns


def calculate_moon_phase(date) -> str:
    """
    Calculate moon phase for a given date.
    
    Uses simplified calculation based on lunar cycle of 29.53 days.
    
    Returns:
        'new_moon': Days around new moon (-3 to +3 days)
        'full_moon': Days around full moon (-3 to +3 days)
        'other': All other days
    """
    # Convert to naive datetime if timezone-aware
    if isinstance(date, pd.Timestamp):
        date = date.to_pydatetime()
    if hasattr(date, 'tzinfo') and date.tzinfo is not None:
        date = date.replace(tzinfo=None)
    
    # Known new moon date (reference point)
    known_new_moon = datetime(2000, 1, 6, 18, 14)
    
    # Days since known new moon
    days_since = (date - known_new_moon).days
    
    # Position in lunar cycle (0-29.53 days)
    lunar_day = days_since % 29.53
    
    # Classify (using Yuan 2006 methodology: ±7 days)
    if lunar_day <= 7 or lunar_day >= 22.53:  # Near new moon
        return 'new_moon'
    elif 7.76 <= lunar_day <= 21.76:  # Near full moon  
        return 'full_moon'
    else:
        return 'other'


def load_market_data(filepath: str = "data/processed/merged_data.csv") -> pd.DataFrame:
    """Load S&P 500 data with returns"""
    logger.info(f"Loading market data from {filepath}")
    
    df = pd.read_csv(filepath, index_col=0, parse_dates=True)
    
    # Convert timezone-aware index to naive
    if df.index.tz is not None:
        df.index = df.index.tz_localize(None)
    
    # Ensure we have returns
    if 'Returns' not in df.columns:
        df['Returns'] = df['Close'].pct_change()
    
    logger.success(f"Loaded {len(df)} days from {df.index[0].date()} to {df.index[-1].date()}")
    
    return df


def classify_moon_phases(df: pd.DataFrame) -> pd.DataFrame:
    """Add moon phase classification to dataframe"""
    logger.info("Classifying moon phases...")
    
    df = df.copy()
    df['moon_phase'] = df.index.map(calculate_moon_phase)
    
    counts = df['moon_phase'].value_counts()
    logger.info(f"New Moon days: {counts.get('new_moon', 0)}")
    logger.info(f"Full Moon days: {counts.get('full_moon', 0)}")
    logger.info(f"Other days: {counts.get('other', 0)}")
    
    return df


def analyze_returns_by_phase(df: pd.DataFrame) -> dict:
    """Calculate average returns for each moon phase"""
    logger.info("\n" + "="*60)
    logger.info("MOON PHASE RETURN ANALYSIS")
    logger.info("="*60)
    
    results = {}
    
    for phase in ['new_moon', 'full_moon', 'other']:
        phase_data = df[df['moon_phase'] == phase]['Returns'].dropna()
        
        results[phase] = {
            'mean': phase_data.mean(),
            'median': phase_data.median(),
            'std': phase_data.std(),
            'count': len(phase_data),
            'annualized': phase_data.mean() * 252  # Trading days
        }
        
        logger.info(f"\n{phase.upper()}:")
        logger.info(f"  Daily Return: {results[phase]['mean']:.4%}")
        logger.info(f"  Annualized: {results[phase]['annualized']:.2%}")
        logger.info(f"  Count: {results[phase]['count']} days")
    
    return results


def statistical_tests(df: pd.DataFrame) -> dict:
    """Run statistical tests comparing new vs full moon"""
    logger.info("\n" + "="*60)
    logger.info("STATISTICAL TESTS")
    logger.info("="*60)
    
    new_moon = df[df['moon_phase'] == 'new_moon']['Returns'].dropna()
    full_moon = df[df['moon_phase'] == 'full_moon']['Returns'].dropna()
    
    # T-test
    t_stat, t_pval = stats.ttest_ind(new_moon, full_moon)
    
    # Mann-Whitney U
    u_stat, u_pval = stats.mannwhitneyu(new_moon, full_moon, alternative='two-sided')
    
    # Effect size
    pooled_std = np.sqrt((new_moon.std()**2 + full_moon.std()**2) / 2)
    cohens_d = (new_moon.mean() - full_moon.mean()) / pooled_std
    
    diff_annual = (new_moon.mean() - full_moon.mean()) * 252
    
    logger.info(f"\nT-Test:")
    logger.info(f"  t-stat: {t_stat:.4f}, p-value: {t_pval:.6f}")
    logger.info(f"  Significant? {'YES (p<0.05)' if t_pval < 0.05 else 'NO'}")
    
    logger.info(f"\nEffect Size: Cohen's d = {cohens_d:.4f}")
    logger.info(f"Annual Difference: {diff_annual:.2%}")
    logger.info(f"Yuan (2006) found: 3-5% difference")
    
    return {
        't_statistic': t_stat,
        't_pvalue': t_pval,
        'u_statistic': u_stat,
        'u_pvalue': u_pval,
        'cohens_d': cohens_d,
        'difference_annualized': diff_annual
    }


def create_visualizations(df: pd.DataFrame, results: dict):
    """Create charts"""
    logger.info("\nCreating visualizations...")
    
    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    fig.suptitle('Moon Phase Effects on S&P 500 Returns (Replicating Yuan 2006)', 
                 fontsize=14, fontweight='bold')
    
    # Box plot
    ax1 = axes[0, 0]
    df.boxplot(column='Returns', by='moon_phase', ax=ax1)
    ax1.set_title('Return Distribution by Moon Phase')
    ax1.set_xlabel('')
    ax1.set_ylabel('Daily Returns')
    plt.sca(ax1)
    plt.xticks(rotation=0)
    
    # Bar chart
    ax2 = axes[0, 1]
    phases = ['new_moon', 'full_moon', 'other']
    means = [results[p]['annualized'] for p in phases]
    colors = ['green' if m > 0 else 'red' for m in means]
    ax2.bar(phases, means, color=colors, alpha=0.7)
    ax2.set_title('Annualized Returns by Phase')
    ax2.set_ylabel('Annualized Return')
    ax2.axhline(y=0, color='black', linestyle='--', linewidth=0.5)
    plt.sca(ax2)
    plt.xticks(rotation=0)
    
    # Histogram
    ax3 = axes[1, 0]
    for phase in ['new_moon', 'full_moon']:
        phase_returns = df[df['moon_phase'] == phase]['Returns'].dropna()
        ax3.hist(phase_returns, bins=50, alpha=0.5, label=phase)
    ax3.set_title('Return Distribution: New vs Full Moon')
    ax3.set_xlabel('Daily Return')
    ax3.set_ylabel('Frequency')
    ax3.legend()
    
    # Sample counts
    ax4 = axes[1, 1]
    counts = [results[p]['count'] for p in phases]
    ax4.bar(phases, counts, color=['blue', 'orange', 'gray'], alpha=0.7)
    ax4.set_title('Sample Sizes')
    ax4.set_ylabel('Number of Trading Days')
    plt.sca(ax4)
    plt.xticks(rotation=0)
    
    plt.tight_layout()
    plt.savefig('docs/research/moon_phase_analysis.png', dpi=300, bbox_inches='tight')
    logger.success("Saved: docs/research/moon_phase_analysis.png")
    plt.close()


def generate_report(results: dict, stats_results: dict):
    """Generate markdown report"""
    report = f"""# Moon Phase Replication Study - Results

## Summary

Replication of Yuan et al. (2006) using S&P 500 data.

**Result:** {'✅ CONFIRMED' if stats_results['t_pvalue'] < 0.05 else '❌ NOT CONFIRMED'}

---

## Returns by Moon Phase

| Phase | Daily Return | Annualized | Days |
|-------|-------------|------------|------|
| New Moon | {results['new_moon']['mean']:.4%} | {results['new_moon']['annualized']:.2%} | {results['new_moon']['count']} |
| Full Moon | {results['full_moon']['mean']:.4%} | {results['full_moon']['annualized']:.2%} | {results['full_moon']['count']} |
| Other | {results['other']['mean']:.4%} | {results['other']['annualized']:.2%} | {results['other']['count']} |

**Difference (New - Full):** {stats_results['difference_annualized']:.2%} per year

---

## Statistical Tests

- **T-test:** t={stats_results['t_statistic']:.3f}, p={stats_results['t_pvalue']:.4f}
- **Significant?** {'YES' if stats_results['t_pvalue'] < 0.05 else 'NO'}
- **Effect Size:** Cohen's d = {stats_results['cohens_d']:.3f}

---

## Comparison to Yuan (2006)

**Their Finding:** 3-5% annualized difference  
**Our Finding:** {stats_results['difference_annualized']:.2%}

**Match?** {'✅ Similar magnitude' if 0.02 <= abs(stats_results['difference_annualized']) <= 0.06 else '⚠️ Different'}

---

![Analysis](moon_phase_analysis.png)
"""
    
    with open('docs/research/moon_phase_replication.md', 'w', encoding='utf-8') as f:
        f.write(report)
    logger.success("Saved: docs/research/moon_phase_replication.md")


def main():
    """Run analysis"""
    logger.info("="*60)
    logger.info("MOON PHASE REPLICATION STUDY")
    logger.info("Replicating Yuan et al. (2006)")
    logger.info("="*60)
    
    try:
        df = load_market_data()
        df = classify_moon_phases(df)
        results = analyze_returns_by_phase(df)
        stats_results = statistical_tests(df)
        create_visualizations(df, results)
        generate_report(results, stats_results)
        
        logger.success("\n✅ ANALYSIS COMPLETE")
        logger.info("Results in docs/research/")
        
    except Exception as e:
        logger.error(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    return 0


if __name__ == "__main__":
    exit(main())
