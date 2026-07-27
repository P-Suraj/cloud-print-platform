import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/shop_provider.dart';
import '../providers/pending_jobs_provider.dart';
import '../widgets/shop_card.dart';
import '../widgets/pending_jobs_card.dart';
import 'shop_picker_screen.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final shopState = ref.watch(shopProvider);
    final favShop = shopState.favouriteShop;
    final pendingJobs = ref.watch(pendingJobsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('AutoPrint Share'),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Hero Banner
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFF6366F1), Color(0xFF4F46E5)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: const [
                    Text(
                      'Print Directly from WhatsApp',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    SizedBox(height: 6),
                    Text(
                      'Share any PDF or document from WhatsApp or Files → Choose AutoPrint → Pick your shop.',
                      style: TextStyle(color: Color(0xFFE0E7FF), fontSize: 13, height: 1.4),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),

              // Pending Offline Jobs (Manual Retry)
              if (pendingJobs.isNotEmpty) ...[
                const Text(
                  'Pending Uploads (Offline Queue)',
                  style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
                ),
                const SizedBox(height: 10),
                ListView.separated(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  itemCount: pendingJobs.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 8),
                  itemBuilder: (context, index) {
                    final p = pendingJobs[index];
                    return PendingJobsCard(
                      item: p,
                      onRetry: () {
                        // Trigger manual retry
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Retrying upload...')),
                        );
                      },
                      onDiscard: () {
                        ref.read(pendingJobsProvider.notifier).removePendingJob(p.jobId);
                      },
                    );
                  },
                ),
                const SizedBox(height: 24),
              ],

              // Favourite Shop Section
              const Text(
                'Favourite Shop',
                style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
              ),
              const SizedBox(height: 10),
              if (favShop != null)
                ShopCard(
                  shop: favShop,
                  isFavourite: true,
                  onTap: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const ShopPickerScreen(sharedFiles: []),
                      ),
                    );
                  },
                  onFavouriteToggle: () {
                    ref.read(shopProvider.notifier).removeFavouriteShop();
                  },
                )
              else
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1A1A22),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFF2A2A36)),
                  ),
                  child: Row(
                    children: const [
                      Icon(Icons.star_outline_rounded, color: Color(0xFF6B7280), size: 24),
                      SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          'No favourite shop set yet.\nTap ⭐ on any shop card to set one.',
                          style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 13, height: 1.3),
                        ),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: 24),

              // Scan QR Shortcut Button
              ElevatedButton.icon(
                onPressed: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => const ShopPickerScreen(sharedFiles: []),
                    ),
                  );
                },
                icon: const Icon(Icons.qr_code_scanner_rounded),
                label: const Text('Scan Shop QR Code'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF1A1A22),
                  foregroundColor: Colors.white,
                  side: const BorderSide(color: Color(0xFF6366F1)),
                ),
              ),
              const SizedBox(height: 24),

              // How to use guide
              ExpansionTile(
                title: const Text(
                  'How to print from WhatsApp',
                  style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 14),
                ),
                leading: const Icon(Icons.help_outline_rounded, color: Color(0xFF6366F1)),
                childrenPadding: const EdgeInsets.all(14),
                collapsedBackgroundColor: const Color(0xFF1A1A22),
                backgroundColor: const Color(0xFF1A1A22),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                collapsedShape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                children: const [
                  ListTile(
                    leading: CircleAvatar(child: Text('1'), backgroundColor: Color(0xFF6366F1), radius: 14),
                    title: Text('Open any PDF or document in WhatsApp', style: TextStyle(fontSize: 13, color: Colors.white)),
                  ),
                  ListTile(
                    leading: CircleAvatar(child: Text('2'), backgroundColor: Color(0xFF6366F1), radius: 14),
                    title: Text('Tap Share → Select "AutoPrint Share"', style: TextStyle(fontSize: 13, color: Colors.white)),
                  ),
                  ListTile(
                    leading: CircleAvatar(child: Text('3'), backgroundColor: Color(0xFF6366F1), radius: 14),
                    title: Text('Choose your print shop & submit!', style: TextStyle(fontSize: 13, color: Colors.white)),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
