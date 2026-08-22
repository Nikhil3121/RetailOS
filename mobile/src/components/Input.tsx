/**
 * Input — matches desktop/src/components/ui/Input.tsx:
 *   • Uppercase-tracked label above
 *   • rounded-xl border + bg-white/[0.02] field
 *   • cobalt focus ring, rose on error
 *   • optional leading icon slot
 *   • hint / error text below
 */

import type React from 'react';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, radius } from '@/constants/theme';

interface InputProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
}

export function Input({
  label,
  hint,
  error,
  leadingIcon,
  trailingIcon,
  style,
  onFocus,
  onBlur,
  ...rest
}: InputProps): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  const invalid = !!error;

  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View
        style={[
          styles.field,
          focused && !invalid && styles.focused,
          invalid && styles.invalid,
        ]}
      >
        {leadingIcon ? <View style={styles.leading}>{leadingIcon}</View> : null}
        <TextInput
          placeholderTextColor={colors.slate500}
          {...rest}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, leadingIcon ? styles.inputWithLeading : null, style]}
        />
        {trailingIcon ? <View style={styles.trailing}>{trailingIcon}</View> : null}
      </View>
      {error ? (
        <Text style={styles.err}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: {
    color: colors.slate400,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    backgroundColor: 'rgba(255,255,255,0.02)',
    paddingHorizontal: 14,
    minHeight: 44,
  },
  focused: {
    borderColor: colors.cobalt400,
  },
  invalid: {
    borderColor: 'rgba(244,63,94,0.5)',
  },
  input: {
    flex: 1,
    color: colors.slate100,
    fontSize: 15,
    paddingVertical: 10,
  },
  inputWithLeading: {
    marginLeft: 8,
  },
  leading: {
    justifyContent: 'center',
  },
  trailing: {
    marginLeft: 8,
    justifyContent: 'center',
  },
  hint: {
    color: colors.slate500,
    fontSize: 11,
  },
  err: {
    color: colors.rose300,
    fontSize: 11,
  },
});
