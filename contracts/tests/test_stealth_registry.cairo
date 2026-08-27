use ghostcall_contracts::stealth_registry::{
    IStealthRegistryDispatcher, IStealthRegistryDispatcherTrait,
};
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, spy_events, EventSpyAssertionsTrait,
};
use ghostcall_contracts::stealth_registry::StealthRegistry;

fn deploy() -> IStealthRegistryDispatcher {
    let contract_class = declare("StealthRegistry").unwrap().contract_class();
    let (contract_address, _) = contract_class.deploy(@array![]).unwrap();
    IStealthRegistryDispatcher { contract_address }
}

#[test]
fn test_register_and_lookup() {
    let contract = deploy();
    let handle_hash: felt252 = 0xdeadbeef;
    let pk_v_x: felt252 = 0x1111;
    let pk_v_y: felt252 = 0x2222;
    let pk_s_x: felt252 = 0x3333;
    let pk_s_y: felt252 = 0x4444;

    contract.register(handle_hash, pk_v_x, pk_v_y, pk_s_x, pk_s_y);

    let (rvx, rvy, rsx, rsy) = contract.get_stealth_meta(handle_hash);
    assert(rvx == pk_v_x, 'pk_v_x mismatch');
    assert(rvy == pk_v_y, 'pk_v_y mismatch');
    assert(rsx == pk_s_x, 'pk_s_x mismatch');
    assert(rsy == pk_s_y, 'pk_s_y mismatch');
}

#[test]
#[should_panic(expected: ('handle already taken',))]
fn test_register_duplicate_fails() {
    let contract = deploy();
    contract.register(0xabc, 1, 2, 3, 4);
    contract.register(0xabc, 5, 6, 7, 8);
}

#[test]
#[should_panic(expected: ('handle not found',))]
fn test_lookup_unregistered_fails() {
    let contract = deploy();
    contract.get_stealth_meta(0xdeadbeef);
}

#[test]
fn test_is_registered_before_and_after() {
    let contract = deploy();
    let handle_hash: felt252 = 0xabcdef;

    assert(!contract.is_registered(handle_hash), 'should not be registered');
    contract.register(handle_hash, 1, 2, 3, 4);
    assert(contract.is_registered(handle_hash), 'should be registered');
}

#[test]
fn test_register_emits_event() {
    let contract = deploy();
    let mut spy = spy_events();

    let handle_hash: felt252 = 0xbeef;
    let pk_v_x: felt252 = 0x1;
    let pk_v_y: felt252 = 0x2;
    let pk_s_x: felt252 = 0x3;
    let pk_s_y: felt252 = 0x4;

    contract.register(handle_hash, pk_v_x, pk_v_y, pk_s_x, pk_s_y);

    spy
        .assert_emitted(
            @array![
                (
                    contract.contract_address,
                    StealthRegistry::Event::Registered(
                        StealthRegistry::Registered {
                            handle_hash, pk_v_x, pk_v_y, pk_s_x, pk_s_y,
                        },
                    ),
                ),
            ],
        );
}
