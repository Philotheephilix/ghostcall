use ghostcall_contracts::call_log::{ICallLogDispatcher, ICallLogDispatcherTrait};
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, spy_events, EventSpyAssertionsTrait,
};
use ghostcall_contracts::call_log::CallLog;

fn deploy() -> ICallLogDispatcher {
    let contract_class = declare("CallLog").unwrap().contract_class();
    let (contract_address, _) = contract_class.deploy(@array![]).unwrap();
    ICallLogDispatcher { contract_address }
}

#[test]
fn test_commit_and_query() {
    let contract = deploy();
    let commitment: felt252 = 0xcafebabe;

    assert(!contract.is_committed(commitment), 'should not be committed yet');
    contract.commit_call(commitment);
    assert(contract.is_committed(commitment), 'should be committed');
}

#[test]
fn test_not_committed_before_call() {
    let contract = deploy();
    assert(!contract.is_committed(0x9999), 'should be false initially');
}

#[test]
#[should_panic(expected: ('already committed',))]
fn test_double_commit_fails() {
    let contract = deploy();
    contract.commit_call(0x1234);
    contract.commit_call(0x1234);
}

#[test]
fn test_commit_emits_event() {
    let contract = deploy();
    let mut spy = spy_events();

    let commitment: felt252 = 0xdeadcafe;
    contract.commit_call(commitment);

    spy
        .assert_emitted(
            @array![
                (
                    contract.contract_address,
                    CallLog::Event::CallCommitted(CallLog::CallCommitted { commitment }),
                ),
            ],
        );
}
