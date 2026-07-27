import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../models/shop.dart';
import '../providers/share_provider.dart';
import '../providers/shop_provider.dart';
import '../providers/upload_provider.dart';
import '../widgets/shop_card.dart';
import '../widgets/options_bottom_sheet.dart';
import 'upload_screen.dart';

class ShopPickerScreen extends ConsumerStatefulWidget {
  final List<SharedFile> sharedFiles;

  const ShopPickerScreen({super.key, required this.sharedFiles});

  @override
  ConsumerState<ShopPickerScreen> createState() => _ShopPickerScreenState();
}

class _ShopPickerScreenState extends ConsumerState<ShopPickerScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final TextEditingController _searchController = TextEditingController();
  bool _isSearching = false;
  String? _searchError;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  void _onShopSelected(Shop shop) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => OptionsBottomSheet(
        shop: shop,
        fileCount: widget.sharedFiles.length,
        onConfirm: (options) {
          ref.read(uploadProvider.notifier).submitJob(
                shop: shop,
                files: widget.sharedFiles,
                options: options,
              );
          Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const UploadScreen()),
          );
        },
      ),
    );
  }

  Future<void> _handleManualSearch() async {
    final input = _searchController.text.trim();
    if (input.isEmpty) return;

    setState(() {
      _isSearching = true;
      _searchError = null;
    });

    final notifier = ref.read(shopProvider.notifier);
    final code = notifier.parseShopCode(input);

    if (code == null) {
      setState(() {
        _isSearching = false;
        _searchError = 'Invalid shop code or QR link';
      });
      return;
    }

    final shop = await notifier.resolveShopCode(code);
    setState(() => _isSearching = false);

    if (shop != null) {
      _onShopSelected(shop);
    } else {
      setState(() => _searchError = 'Shop "$code" not found. Contact shopkeeper.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final shopState = ref.watch(shopProvider);
    final favShop = shopState.favouriteShop;
    final recentShops = shopState.recentShops;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Select Print Shop'),
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: const Color(0xFF6366F1),
          labelColor: Colors.white,
          unselectedLabelColor: const Color(0xFF9CA3AF),
          tabs: const [
            Tab(icon: Icon(Icons.star_rounded, size: 18), text: 'Favourite'),
            Tab(icon: Icon(Icons.history_rounded, size: 18), text: 'Recents'),
            Tab(icon: Icon(Icons.qr_code_scanner_rounded, size: 18), text: 'Scan QR'),
          ],
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            // Code Search Bar
            Padding(
              padding: const EdgeInsets.all(16.0),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _searchController,
                      style: const TextStyle(color: Colors.white, fontSize: 14),
                      decoration: InputDecoration(
                        hintText: 'Enter Shop Code (e.g. TST001)',
                        hintStyle: const TextStyle(color: Color(0xFF6B7280), fontSize: 13),
                        filled: true,
                        fillColor: const Color(0xFF1A1A22),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10),
                          borderSide: const BorderSide(color: Color(0xFF2A2A36)),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10),
                          borderSide: const BorderSide(color: Color(0xFF6366F1)),
                        ),
                      ),
                      onSubmitted: (_) => _handleManualSearch(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton(
                    onPressed: _isSearching ? null : _handleManualSearch,
                    style: ElevatedButton.styleFrom(
                      minimumSize: const Size(60, 44),
                      padding: EdgeInsets.zero,
                    ),
                    child: _isSearching
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : const Icon(Icons.arrow_forward_rounded),
                  ),
                ],
              ),
            ),
            if (_searchError != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16.0),
                child: Text(
                  _searchError!,
                  style: const TextStyle(color: Color(0xFFEF4444), fontSize: 12),
                ),
              ),

            const SizedBox(height: 8),

            // Tab Views
            Expanded(
              child: TabBarView(
                controller: _tabController,
                children: [
                  // Tab 1: Favourites
                  Padding(
                    padding: const EdgeInsets.all(16.0),
                    child: favShop != null
                        ? ShopCard(
                            shop: favShop,
                            isFavourite: true,
                            onTap: () => _onShopSelected(favShop),
                            onFavouriteToggle: () {
                              ref.read(shopProvider.notifier).removeFavouriteShop();
                            },
                          )
                        : const Center(
                            child: Text(
                              'No favourite shop set yet.\nTap ⭐ on any shop card to favourite it.',
                              textAlign: TextAlign.center,
                              style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 13, height: 1.4),
                            ),
                          ),
                  ),

                  // Tab 2: Recents
                  recentShops.isNotEmpty
                      ? ListView.separated(
                          padding: const EdgeInsets.all(16),
                          itemCount: recentShops.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 10),
                          itemBuilder: (context, index) {
                            final s = recentShops[index];
                            final isFav = favShop?.id == s.id;
                            return ShopCard(
                              shop: s,
                              isFavourite: isFav,
                              onTap: () => _onShopSelected(s),
                              onFavouriteToggle: () {
                                if (isFav) {
                                  ref.read(shopProvider.notifier).removeFavouriteShop();
                                } else {
                                  ref.read(shopProvider.notifier).setFavouriteShop(s);
                                }
                              },
                            );
                          },
                        )
                      : const Center(
                          child: Text(
                            'No recent shops.\nScan a QR code or type a shop code above.',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 13, height: 1.4),
                          ),
                        ),

                  // Tab 3: Scan QR (MobileScanner)
                  MobileScanner(
                    onDetect: (BarcodeCapture capture) async {
                      final barcode = capture.barcodes.firstOrNull;
                      if (barcode?.rawValue != null) {
                        final raw = barcode!.rawValue!;
                        final notifier = ref.read(shopProvider.notifier);
                        final code = notifier.parseShopCode(raw);
                        if (code != null) {
                          final shop = await notifier.resolveShopCode(code);
                          if (shop != null) {
                            _onShopSelected(shop);
                          }
                        }
                      }
                    },
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
