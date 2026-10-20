import { useState } from 'react';
import { LanguageSwitch } from './i18n/LanguageSwitch';
import type { FormEvent } from 'react';
import { Alert, AlertIcon, Box, Button, Flex, FormControl, FormLabel, Input, Text, VStack } from '@chakra-ui/react';
import axios from 'axios';
import { http, setToken } from './api';
import type { LoginResponse, User } from './api';
import { ColorModeButton, Logo } from './components/Sidebar';
import { t } from './i18n/index.ts';

interface LoginProps {
  onLoggedIn: (user: User) => void;
  notice?: string;
}

function Login({ onLoggedIn, notice }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError('');
    try {
      const res = await http.post<LoginResponse>('/api/auth/login', { username: username.trim(), password });
      setToken(res.data.token);
      onLoggedIn(res.data.user);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        setError(t('Wrong username or password.'));
      } else if (axios.isAxiosError(err) && err.response?.status === 429) {
        const wait = err.response.headers['retry-after'];
        setError(wait ? t('Too many attempts. Try again in {n} seconds.', { n: wait }) : t('Too many attempts. Try again in a few seconds.'));
      } else {
        setError(t('The server is not reachable. Make sure the backend is running.'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flex
      minH="100vh"
      align="center"
      justify="center"
      p={6}
      position="relative"
      bgGradient="radial(circle at 20% 10%, rgba(99,102,241,0.22), transparent 45%), radial(circle at 85% 90%, rgba(56,189,248,0.12), transparent 40%)"
    >
      <Box position="absolute" top={4} right={4} display="flex" gap={1}>
        <LanguageSwitch />
        <ColorModeButton />
      </Box>
      <Box
        as="form"
        onSubmit={submit}
        w="100%"
        maxW="400px"
        bg="panelBg"
        border="1px solid"
        borderColor="lineColor"
        borderRadius="2xl"
        p={8}
        boxShadow="0 24px 60px -24px rgba(79,70,229,0.45)"
      >
        <VStack spacing={6} align="stretch">
          <Logo />
          <Box>
            <Text fontSize="xl" fontWeight={650}>
              {t('Sign in')}
            </Text>
            <Text fontSize="sm" color="mutedText">
              {t('Use the account your administrator created for you.')}
            </Text>
          </Box>
          {(notice || error) && (
            <Alert status={error ? 'error' : 'warning'} borderRadius="lg" fontSize="sm" alignItems="flex-start">
              <AlertIcon />
              {error || notice}
            </Alert>
          )}
          <FormControl>
            <FormLabel fontSize="sm">{t('Username')}</FormLabel>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
          </FormControl>
          <FormControl>
            <FormLabel fontSize="sm">{t('Password')}</FormLabel>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </FormControl>
          <Button type="submit" size="lg" isLoading={loading} loadingText={t('Signing in')}>
            {t('Sign in')}
          </Button>
        </VStack>
      </Box>
    </Flex>
  );
}

export default Login;
