import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:receive_sharing_intent/receive_sharing_intent.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'core/constants.dart';
import 'core/theme.dart';
import 'providers/share_provider.dart';
import 'screens/home_screen.dart';
import 'screens/receive_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize Supabase
  try {
    await Supabase.initialize(
      url: AppConstants.supabaseUrl,
      publishableKey: AppConstants.supabaseAnonKey,
    );
  } catch (e) {
    debugPrint('Supabase init error: $e');
  }

  runApp(
    const ProviderScope(
      child: AutoPrintApp(),
    ),
  );
}

class AutoPrintApp extends StatelessWidget {
  const AutoPrintApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AutoPrint Share',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.darkTheme,
      home: const AppEntryRouter(),
    );
  }
}

class AppEntryRouter extends ConsumerStatefulWidget {
  const AppEntryRouter({super.key});

  @override
  ConsumerState<AppEntryRouter> createState() => _AppEntryRouterState();
}

class _AppEntryRouterState extends ConsumerState<AppEntryRouter> {
  StreamSubscription? _intentDataStreamSubscription;

  @override
  void initState() {
    super.initState();

    // 1. Listen to sharing intent stream while app is running in memory
    _intentDataStreamSubscription = ReceiveSharingIntent.instance
        .getMediaStream()
        .listen((List<SharedMediaFile> value) {
      if (value.isNotEmpty) {
        ref.read(shareProvider.notifier).setSharedMedia(value);
      }
    }, onError: (err) {
      debugPrint("getIntentDataStream error: $err");
    });

    // 2. Handle sharing intent when app is launched cold from share sheet
    ReceiveSharingIntent.instance.getInitialMedia().then((List<SharedMediaFile> value) {
      if (value.isNotEmpty) {
        ref.read(shareProvider.notifier).setSharedMedia(value);
      }
    }).catchError((err) {
      debugPrint("getInitialMedia error: $err");
    });
  }

  @override
  void dispose() {
    _intentDataStreamSubscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sharedFiles = ref.watch(shareProvider);

    // If shared files are present from share intent -> show ReceiveScreen
    if (sharedFiles.isNotEmpty) {
      return const ReceiveScreen();
    }

    // Otherwise -> normal HomeScreen
    return const HomeScreen();
  }
}
