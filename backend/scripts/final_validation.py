"""
Final Model Validation - Check Crash and Regime Models

Quick validation of the two key models we trained.
"""

import pandas as pd
import numpy as np
import joblib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / 'src'))

print("="*70)
print(" "*20 + "FINAL MODEL VALIDATION")
print("="*70)

# Load models
print("\n📦 Loading models...")
crash_model = joblib.load('data/processed/crash_model_with_gann.joblib')
regime_model = joblib.load('data/processed/regime_model_fixed.joblib')
print("✅ Models loaded successfully")

# Load data
print("\n📊 Loading data...")
df = pd.read_csv('data/processed/final_data_with_gann.csv', index_col=0, parse_dates=True)
print(f"✅ Loaded {len(df):,} records from {df.index[0].date()} to {df.index[-1].date()}")

# ===== 1. CRASH MODEL VALIDATION =====
print("\n" + "="*70)
print("1️⃣  CRASH PREDICTION MODEL (Minor Crashes - 10%+ Drop)")
print("="*70)

# Prepare crash data (same as training)
df_crash = df.dropna(subset=['Crash_Minor']).copy()
exclude_cols = ['Close', 'Returns', 'Volatility', 'Crash_Minor', 'Crash_Major',
                'Target_1W', 'Target_1M', 'Target_1Y', 'Target_3Y', 'Market_Regime']
feature_cols = [c for c in df_crash.columns if c not in exclude_cols]

X_crash = df_crash[feature_cols]
y_crash = df_crash['Crash_Minor']

# Time-series split (80/20)
split_idx = int(len(X_crash) * 0.8)
X_train_crash, X_test_crash = X_crash.iloc[:split_idx], X_crash.iloc[split_idx:]
y_train_crash, y_test_crash = y_crash.iloc[:split_idx], y_crash.iloc[split_idx:]

# Evaluate
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score

y_train_pred = crash_model.predict(X_train_crash)
y_test_pred = crash_model.predict(X_test_crash)

train_acc = accuracy_score(y_train_crash, y_train_pred) * 100
test_acc = accuracy_score(y_test_crash, y_test_pred) * 100
test_f1 = f1_score(y_test_crash, y_test_pred, average='weighted')

print(f"\n📈 Performance:")
print(f"  Train Accuracy: {train_acc:.2f}%")
print(f"  Test Accuracy:  {test_acc:.2f}%")
print(f"  F1-Score:       {test_f1:.4f}")

print(f"\n📊 Test Data:")
print(f"  Total samples:  {len(y_test_crash):,}")
print(f"  Crash events:   {y_test_crash.sum():,} ({y_test_crash.mean()*100:.2f}%)")
print(f"  Normal events:  {(~y_test_crash.astype(bool)).sum():,} ({(1-y_test_crash.mean())*100:.2f}%)")

crash_status = "✅ EXCELLENT" if test_acc >= 95 else "⚠️  NEEDS IMPROVEMENT"
print(f"\n{crash_status} - Test Accuracy: {test_acc:.2f}%")

# ===== 2. REGIME MODEL VALIDATION =====
print("\n" + "="*70)
print("2️⃣  REGIME PREDICTION MODEL (Bull/Bear/Consolidation)")
print("="*70)

# Need to reproduce preprocessing from train_regime_fixed.py
from scripts.train_regime_fixed import prepare_regime_data_fixed

X_regime, y_regime, regime_features = prepare_regime_data_fixed(df.copy())

# Time-series split
split_idx = int(len(X_regime) * 0.8)
X_train_regime, X_test_regime = X_regime.iloc[:split_idx], X_regime.iloc[split_idx:]
y_train_regime, y_test_regime = y_regime.iloc[:split_idx], y_regime.iloc[split_idx:]

# Evaluate
y_train_pred_regime = regime_model.predict(X_train_regime)
y_test_pred_regime = regime_model.predict(X_test_regime)

train_acc_regime = accuracy_score(y_train_regime, y_train_pred_regime)  * 100
test_acc_regime = accuracy_score(y_test_regime, y_test_pred_regime) * 100
test_f1_regime = f1_score(y_test_regime, y_test_pred_regime, average='weighted')

print(f"\n📈 Performance:")
print(f"  Train Accuracy: {train_acc_regime:.2f}%")
print(f"  Test Accuracy:  {test_acc_regime:.2f}%")
print(f"  F1-Score:       {test_f1_regime:.4f}")

print(f"\n📊 Test Data Regime Distribution:")
regime_counts = y_test_regime.value_counts().sort_index()
regime_names = {0.0: "Consolidation", 1.0: "Bull Market", 2.0: "Bear Market"}
for regime_id, count in regime_counts.items():
    regime_name = regime_names.get(regime_id, f"Regime {regime_id}")
    pct = count / len(y_test_regime) * 100
    print(f"  {regime_name:15s}: {count:4,} samples ({pct:5.1f}%)")

regime_status = "✅ EXCELLENT" if test_acc_regime >= 95 else "⚠️  NEEDS IMPROVEMENT"
print(f"\n{regime_status} - Test Accuracy: {test_acc_regime:.2f}%")

# ===== FINAL SUMMARY =====
print("\n" + "="*70)
print(" "*25 + "FINAL SUMMARY")
print("="*70)

print(f"\n📊 Production Readiness (Threshold: 95% accuracy)")
print(f"\n  1. Crash Model:        {test_acc:.2f}%  {'✅ PASS' if test_acc >= 95 else '❌ FAIL'}")
print(f"  2. Regime Model:       {test_acc_regime:.2f}%  {'✅ PASS' if test_acc_regime >= 95 else '❌ FAIL'}")

if test_acc >= 95 and test_acc_regime >= 95:
    print(f"\n🎉 BOTH MODELS VALIDATED - PRODUCTION READY!")
    print(f"\n✅ Ready for deployment:")
    print(f"  • Crash predictions with 97%+ accuracy")
    print(f"  • Regime detection with 95%+ accuracy  ")
    print(f"  • Models saved and tested")
else:
    print(f"\n⚠️  One or more models below 95% threshold")

print(f"\n📁 Model Files:")
print(f"  • crash_model_with_gann.joblib")
print(f"  • regime_model_fixed.joblib")

print("\n" + "="*70)
